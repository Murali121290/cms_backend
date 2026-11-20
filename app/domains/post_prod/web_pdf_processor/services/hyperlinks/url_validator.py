"""
URL Validation & SSRF-Protected Reachability Service.

Validates URLs against syntax, SSRF security policies (blocking private/internal IPs),
DNS resolution, and safe HTTP reachability with redirect tracking.
"""
import socket
import ipaddress
import urllib.parse
import logging
from typing import Dict, Tuple, Optional, List, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

from .models import UrlValidationResult

logger = logging.getLogger(__name__)

# Common browser user-agent to prevent false bot-rejections
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Standard HTTP status code descriptions
STATUS_DESCRIPTIONS = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
}


def is_ssrf_safe_url(url: str) -> Tuple[bool, str]:
    """
    Validates that a URL does not point to localhost, private/internal IP ranges,
    link-local metadata services, or non-HTTP protocols (SSRF protection).
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception as e:
        return False, f"Malformed URL syntax: {e}"

    if parsed.scheme.lower() not in ('http', 'https'):
        return False, f"Unsupported protocol scheme '{parsed.scheme}'. Only HTTP/HTTPS allowed."

    hostname = parsed.hostname
    if not hostname:
        return False, "URL is missing a valid hostname or domain."

    lower_host = hostname.lower()
    
    # Block well-known localhost and internal domain names
    blocked_host_patterns = (
        'localhost', '127.0.0.1', '::1', '0.0.0.0',
        'metadata.google.internal', 'instance-data',
        '169.254.169.254'
    )
    if lower_host in blocked_host_patterns or lower_host.endswith(('.localhost', '.local', '.internal', '.lan')):
        return False, f"Access blocked to internal hostname '{hostname}'"

    # Resolve hostname via DNS and check every resolved IP address
    port = parsed.port or (443 if parsed.scheme.lower() == 'https' else 80)
    try:
        addrinfo = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        return False, f"DNS resolution failed: {e.strerror or 'Host not found'}"
    except Exception as e:
        return False, f"DNS resolution error: {e}"

    for family, socktype, proto, canonname, sockaddr in addrinfo:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_private or
                ip.is_loopback or
                ip.is_reserved or
                ip.is_link_local or
                ip.is_multicast or
                ip.is_unspecified
            ):
                return False, f"SSRF blocked: Hostname resolves to private/internal IP address ({ip_str})"
        except ValueError:
            return False, f"Invalid IP address resolved ({ip_str})"

    return True, "Safe"


def check_single_url_status(url: str, max_redirects: int = 5) -> UrlValidationResult:
    """
    Checks HTTP reachability of a single URL safely:
    - Validates SSRF safety.
    - Employs HEAD request first, falling back to GET for 405/403.
    - Manually tracks redirect chains, revalidating SSRF on every hop.
    - Classifies results accurately.
    """
    # 1. SSRF and syntax pre-check
    safe, reason = is_ssrf_safe_url(url)
    if not safe:
        is_ssrf = "SSRF blocked" in reason
        status_name = "Invalid" if not is_ssrf else "Invalid"
        return UrlValidationResult(
            url=url,
            is_valid=False,
            status=status_name,
            http_status=None,
            http_description=reason,
            is_ok=False,
            final_url=url,
            error_detail=reason,
            is_ssrf_blocked=is_ssrf
        )

    # 2. Perform safe HTTP request with custom redirect handling
    headers = {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }

    current_url = url
    redirect_chain = []
    final_resp = None

    try:
        with requests.Session() as session:
            for _ in range(max_redirects):
                # Verify SSRF on each hop
                safe, reason = is_ssrf_safe_url(current_url)
                if not safe:
                    return UrlValidationResult(
                        url=url,
                        is_valid=False,
                        status="Invalid",
                        http_status=None,
                        http_description=f"Redirect blocked: {reason}",
                        is_ok=False,
                        final_url=current_url,
                        redirect_chain=redirect_chain,
                        error_detail=reason,
                        is_ssrf_blocked=True
                    )

                # Try HEAD first
                try:
                    resp = session.head(
                        current_url,
                        headers=headers,
                        allow_redirects=False,
                        timeout=(2.5, 3.0),
                        verify=True
                    )
                    # Some servers reject HEAD with 405 Method Not Allowed or 403 Forbidden
                    if resp.status_code in (405, 403):
                        resp = session.get(
                            current_url,
                            headers=headers,
                            allow_redirects=False,
                            timeout=(2.5, 3.0),
                            stream=True,
                            verify=True
                        )
                except requests.exceptions.RequestException:
                    # Fallback directly to GET if HEAD failed
                    resp = session.get(
                        current_url,
                        headers=headers,
                        allow_redirects=False,
                        timeout=(2.5, 3.0),
                        stream=True,
                        verify=True
                    )

                final_resp = resp
                status_code = resp.status_code

                # Handle redirect status codes
                if status_code in (301, 302, 303, 307, 308) and 'Location' in resp.headers:
                    next_loc = resp.headers['Location'].strip()
                    next_url = urllib.parse.urljoin(current_url, next_loc)
                    redirect_chain.append(next_url)
                    current_url = next_url
                else:
                    break

        status_code = final_resp.status_code
        desc = STATUS_DESCRIPTIONS.get(status_code, f"HTTP {status_code}")

        # Classification
        if 200 <= status_code < 300:
            status_label = "Redirected" if redirect_chain else "Valid"
            is_ok = True
        elif status_code in (301, 302, 307, 308):
            status_label = "Redirected"
            is_ok = True
        elif status_code in (401, 403):
            # Access restricted / bot challenge / login required
            # Note: Do not automatically classify as broken when server blocks automated tools!
            status_label = "Access Restricted"
            is_ok = True  # Destination exists and is reachable
        elif status_code in (404, 410):
            status_label = "Broken"
            is_ok = False
        elif status_code >= 500:
            status_label = "Broken"
            is_ok = False
        else:
            status_label = "Manual Review"
            is_ok = (status_code < 400)

        return UrlValidationResult(
            url=url,
            is_valid=is_ok,
            status=status_label,
            http_status=status_code,
            http_description=desc,
            is_ok=is_ok,
            final_url=current_url,
            redirect_chain=redirect_chain
        )

    except requests.exceptions.SSLError as ex:
        return UrlValidationResult(
            url=url, is_valid=False, status="SSL Error",
            http_status=None, http_description="SSL Certificate Validation Failed",
            is_ok=False, final_url=current_url, error_detail=str(ex)
        )
    except requests.exceptions.Timeout as ex:
        return UrlValidationResult(
            url=url, is_valid=False, status="Timeout",
            http_status=None, http_description="Connection or Read Timeout",
            is_ok=False, final_url=current_url, error_detail=str(ex)
        )
    except requests.exceptions.ConnectionError as ex:
        return UrlValidationResult(
            url=url, is_valid=False, status="Unreachable",
            http_status=None, http_description="Connection Error / Host Unreachable",
            is_ok=False, final_url=current_url, error_detail=str(ex)
        )
    except Exception as ex:
        return UrlValidationResult(
            url=url, is_valid=False, status="Manual Review",
            http_status=None, http_description=f"Error: {str(ex)}",
            is_ok=False, final_url=current_url, error_detail=str(ex)
        )


def validate_urls_batch(urls: List[str], max_workers: int = 16) -> Dict[str, UrlValidationResult]:
    """
    Validates a collection of unique URLs in parallel with thread-safe caching.
    """
    unique_urls = list(set(u for u in urls if u))
    results: Dict[str, UrlValidationResult] = {}
    if not unique_urls:
        return results

    worker_count = min(max_workers, max(1, len(unique_urls)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_to_url = {executor.submit(check_single_url_status, url): url for url in unique_urls}
        for future in as_completed(future_to_url):
            orig_url = future_to_url[future]
            try:
                res = future.result()
            except Exception as e:
                res = UrlValidationResult(
                    url=orig_url, is_valid=False, status="Manual Review",
                    http_status=None, http_description=f"Validation failed: {e}",
                    is_ok=False, error_detail=str(e)
                )
            results[orig_url] = res

    return results
