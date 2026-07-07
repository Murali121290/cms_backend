import re
import time
import logging
import requests
import zipfile
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
from io import BytesIO

from app.core.config import get_settings

logger = logging.getLogger("app.integrations.pph")
logger.setLevel(logging.INFO)

class PPHClientError(Exception):
    """Custom exception raised for PPHClient errors."""
    pass

class PPHClient:
    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.PPH_BASE_URL.rstrip("/")
        self.username = self.settings.PPH_USERNAME
        self.password = self.settings.PPH_PASSWORD
        self.session = requests.Session()
        self.session.verify = False  # Ignore self-signed SSL certificate issues on private corporate subnet IPs
        
        # Set standard headers that might be expected by the PPH server
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'DNT': '1',
        })
        
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        self._authenticated = False

    def _login(self) -> bool:
        """Dynamically retrieves the CSRF token and authenticates with the PPH server."""
        try:
            logger.info("Initializing PPH session login...")
            login_url = f"{self.base_url}/login"
            
            # 1. GET login page to retrieve CSRF token
            get_resp = self.session.get(login_url, timeout=15)
            get_resp.raise_for_status()
            
            # Simple regex search for CSRF token in the HTML template
            csrf_match = re.search(r'name="csrf_token"\s+value="([^"]+)"', get_resp.text)
            if not csrf_match:
                csrf_match = re.search(r'id="csrf_token"\s+value="([^"]+)"', get_resp.text)
                
            if not csrf_match:
                logger.error("Failed to extract CSRF token from PPH login page HTML.")
                raise PPHClientError("CSRF token not found on login page.")
                
            csrf_token = csrf_match.group(1)
            logger.debug(f"Found CSRF token: {csrf_token[:8]}...")

            # 2. Submit POST /login with credentials and CSRF token
            payload = {
                "username": self.username,
                "password": self.password,
                "csrf_token": csrf_token
            }
            post_resp = self.session.post(login_url, data=payload, timeout=15)
            post_resp.raise_for_status()

            # Confirm session cookie was set
            if "s4c_session" not in self.session.cookies and "session" not in self.session.cookies:
                logger.warning("Session cookie not found in response cookies. Proceeding anyway.")
            
            logger.info("Successfully authenticated with PPH external server.")
            logger.info(f"Session cookies after login: {dict(self.session.cookies)}")
            self._authenticated = True
            return True
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            logger.error(f"PPH server unreachable at {self.base_url}: {e}")
            self._authenticated = False
            raise PPHClientError(
                "PPH service is unreachable. "
                "The server may be down or the network path is blocked. Please contact IT support."
            )
        except Exception as e:
            logger.error(f"PPH Authentication failure: {e}")
            self._authenticated = False
            raise PPHClientError(f"Authentication failed: {str(e)}")

    def ensure_authenticated(self):
        """Ensures that the session is logged in."""
        if not self._authenticated:
            self._login()

    def _is_login_page(self, response_text: str) -> bool:
        """Check if the response is the PPH login page (indicating session not authenticated)."""
        return (
            '<title>PrepOps' in response_text or 
            'Welcome to PrepOps' in response_text or
            'Please log in to continue' in response_text
        )

    def submit_and_wait(
        self,
        endpoint: str,
        files: Dict[str, Any],
        data: Optional[Dict[str, Any]] = None,
        file_field: str = "files",
        poll_interval: Optional[int] = None,
        max_wait: Optional[int] = None
    ) -> bytes:
        """Submits job to the remote server, polls progress until completed, and downloads output."""
        if max_wait is None:
            max_wait = getattr(self.settings, "PPH_MAX_WAIT_SECONDS", 4500)
        if poll_interval is None:
            poll_interval = getattr(self.settings, "PPH_POLL_INTERVAL_SECONDS", 20)
        self.ensure_authenticated()
        endpoint_clean = endpoint.lstrip("/")

        try:
            # 1. Post job submission
            submit_url = f"{self.base_url}/{endpoint_clean}"
            logger.info(f"Submitting job to PPH endpoint: {submit_url}")
            logger.debug(f"Session cookies before POST: {dict(self.session.cookies)}")

            # GET the upload page first to retrieve a fresh CSRF token (Flask-WTF requires it in the form data)
            get_resp = self.session.get(submit_url, timeout=15)
            
            # Check if we got redirected back to login (session not authenticated)
            if self._is_login_page(get_resp.text):
                error_msg = f"Session appears invalid — PPH /validate endpoint returned login page. Session may have expired or credentials may be incorrect."
                logger.error(error_msg)
                # Reset auth flag and try to re-login
                self._authenticated = False
                self.ensure_authenticated()
                # Retry the GET
                get_resp = self.session.get(submit_url, timeout=15)
                if self._is_login_page(get_resp.text):
                    raise PPHClientError("Failed to access /validate endpoint even after re-authentication.")
            
            csrf_token = None
            csrf_match = re.search(r'name="csrf_token"\s+value="([^"]+)"', get_resp.text)
            if not csrf_match:
                csrf_match = re.search(r'id="csrf_token"\s+value="([^"]+)"', get_resp.text)
            if not csrf_match:
                csrf_match = re.search(r'<meta[^>]+name=["\']csrf-token["\'][^>]+content=["\']([^"\']+)["\']', get_resp.text)
            if csrf_match:
                csrf_token = csrf_match.group(1)
                logger.info("Extracted CSRF token from /validate page.")
            else:
                logger.warning("No CSRF token found on /validate page — posting without it.")

            form_data = dict(data or {})
            if csrf_token:
                form_data["csrf_token"] = csrf_token
            
            logger.debug(f"Form data being sent: {form_data}")
            logger.info(f"Session cookies before POST: {dict(self.session.cookies)}")
            logger.info(f"Request headers: {dict(self.session.headers)}")

            response = self.session.post(
                submit_url,
                files=files,
                data=form_data,
                timeout=120,
                allow_redirects=False  # Don't follow redirects automatically
            )
            logger.info(f"PPH /validate response status: {response.status_code}")
            logger.info(f"PPH /validate Content-Type: {response.headers.get('content-type', 'unknown')}")
            logger.info(f"Response headers: {dict(response.headers)}")
            logger.info(f"Response cookies: {dict(response.cookies)}")
            logger.info(f"PPH /validate response body: {response.text[:500]!r}")
            
            # Check for redirects
            if 300 <= response.status_code < 400:
                redirect_location = response.headers.get('Location', 'unknown')
                logger.warning(f"PPH returned redirect ({response.status_code}) to: {redirect_location}")
                raise PPHClientError(f"PPH endpoint redirected to {redirect_location} instead of accepting the job submission. Session may be invalid.")
            
            response.raise_for_status()

            # Check if response is actually JSON
            content_type = response.headers.get('content-type', '').lower()
            if 'json' not in content_type and response.text.strip().startswith('<'):
                # Response is HTML, likely an error or redirect page
                error_msg = f"PPH endpoint returned HTML instead of JSON (possible login redirect or error page)"
                logger.error(error_msg)
                logger.error(f"Full response: {response.text}")
                raise PPHClientError(error_msg)

            res_json = response.json()
            job_id = res_json.get("job_id")
            if not job_id:
                raise PPHClientError(f"Job submission succeeded but no job_id returned. Response: {res_json}")

            logger.info(f"Job enqueued successfully. Job ID: {job_id}")

            # 2. Poll progress until complete
            start_time = time.time()
            progress_url = f"{self.base_url}/progress/{job_id}"

            while True:
                if time.time() - start_time > max_wait:
                    raise PPHClientError(f"Job {job_id} exceeded maximum wait time of {max_wait}s.")

                try:
                    poll_resp = self.session.get(progress_url, timeout=30)
                    poll_resp.raise_for_status()
                    poll_json = poll_resp.json()
                except Exception as poll_err:
                    logger.warning(f"Transient poll error for job {job_id} (will retry): {poll_err}")
                    time.sleep(poll_interval)
                    continue

                status = poll_json.get("status")
                logger.info(f"Polling job {job_id} progress... Status: {status}")

                if status == "Completed":
                    break
                elif status in ["Failed", "Error"]:
                    error_msg = poll_json.get("error") or "Unknown error"
                    raise PPHClientError(f"Remote processing failed for job {job_id}: {error_msg}")

                time.sleep(poll_interval)

            # 3. Download results
            download_url = f"{self.base_url}/download_zip/{job_id}"
            logger.info(f"Processing complete! Downloading results from {download_url}...")

            dl_resp = self.session.get(download_url, stream=True, timeout=120)
            dl_resp.raise_for_status()

            return dl_resp.content

        except Exception as e:
            logger.error(f"PPH job processing failed: {e}")
            # Reset authentication flag on unexpected failure in case cookie expired
            self._authenticated = False
            raise PPHClientError(f"PPH Server Error: {str(e)}")

    def submit_reference_structuring(
        self,
        file_path: str,
        output_dir: str,
        source_style: str = "Auto",
        target_style: str = "APA",
        poll_interval: Optional[int] = None,
        max_wait: Optional[int] = None
    ) -> List[str]:
        """Submit a .docx file to PPH's /validate endpoint for reference structuring."""
        if max_wait is None:
            max_wait = getattr(self.settings, "PPH_MAX_WAIT_SECONDS", 4500)
        if poll_interval is None:
            poll_interval = getattr(self.settings, "PPH_POLL_INTERVAL_SECONDS", 20)
        logger.info(f"Submitting reference structuring job: {file_path}")

        # Prepare file upload
        with open(file_path, "rb") as f:
            files = {"files": (os.path.basename(file_path), f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
            data = {
                "source_style": source_style,
                "target_style": target_style,
                "run_validation": "true",
                "run_structuring": "true",
                "run_name_year_validation": "false"
            }

            # Call the generic submit_and_wait with /validate endpoint
            zip_bytes = self.submit_and_wait(
                endpoint="/validate",
                files=files,
                data=data,
                poll_interval=poll_interval,
                max_wait=max_wait
            )

        # Extract ZIP to output directory
        output_paths = []
        try:
            with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
                for filename in zf.namelist():
                    output_path = os.path.join(output_dir, os.path.basename(filename))
                    with zf.open(filename) as src, open(output_path, "wb") as dst:
                        dst.write(src.read())
                    output_paths.append(output_path)
                    logger.info(f"Extracted: {output_path}")
        except Exception as e:
            logger.error(f"Failed to extract output ZIP: {e}")
            raise PPHClientError(f"Failed to extract PPH output: {str(e)}")

        logger.info(f"Reference structuring complete. Output files: {output_paths}")
        return output_paths
