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
            self._authenticated = True
            return True
        except Exception as e:
            logger.error(f"PPH Authentication failure: {e}")
            self._authenticated = False
            raise PPHClientError(f"Authentication failed: {str(e)}")

    def ensure_authenticated(self):
        """Ensures that the session is logged in."""
        if not self._authenticated:
            self._login()

    def submit_and_wait(
        self, 
        endpoint: str, 
        files: Dict[str, Any], 
        data: Optional[Dict[str, Any]] = None,
        file_field: str = "files",
        poll_interval: int = 2,
        max_wait: Optional[int] = None
    ) -> bytes:
        if max_wait is None:
            max_wait = getattr(self.settings, "PPH_MAX_WAIT_SECONDS", 1800)
        """
        Submits job to the remote server, polls progress until completed, and downloads output.
        """
        self.ensure_authenticated()
        endpoint_clean = endpoint.lstrip("/")
        
        try:
            # 1. Post job submission
            submit_url = f"{self.base_url}/{endpoint_clean}"
            logger.info(f"Submitting job to PPH endpoint: {submit_url}")
            
            # Extract CSRF token from the session cookies if present
            headers = {}
            csrf_cookie = self.session.cookies.get("csrf_access_token") or self.session.cookies.get("csrf_token")
            if csrf_cookie:
                headers["X-CSRF-Token"] = csrf_cookie

            response = self.session.post(
                submit_url, 
                files=files, 
                data=data or {}, 
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
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
                    
                poll_resp = self.session.get(progress_url, timeout=15)
                poll_resp.raise_for_status()
                poll_json = poll_resp.json()
                
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
            
            dl_resp = self.session.get(download_url, timeout=60)
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
        poll_interval: int = 2,
        max_wait: Optional[int] = None
    ) -> List[str]:
        if max_wait is None:
            max_wait = getattr(self.settings, "PPH_MAX_WAIT_SECONDS", 1800)
        """
        Submit a .docx file to PPH's /validate endpoint for reference structuring.

        Args:
            file_path: Path to the .docx file to process
            output_dir: Directory to save output files
            source_style: Source citation style (Auto, AMA, APA, CGRN)
            target_style: Target citation style (APA, AMA, CGRN)
            poll_interval: Seconds between status polls
            max_wait: Maximum wait time in seconds

        Returns:
            List of paths to output files (docx, log, json)
        """
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
