from ftplib import FTP_TLS
import os
import ssl
import logging
from typing import List

logger = logging.getLogger("app.ftp")

class PatchedFTP_TLS(FTP_TLS):
    """
    Patched FTP_TLS to support TLS Session Resumption on data connections.
    Required for servers that enforce 'require_ssl_reuse' (e.g., pure-ftpd, proftpd).
    """
    def ntransfercmd(self, cmd, rest=None):
        conn, size = super(FTP_TLS, self).ntransfercmd(cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn,
                server_hostname=self.host,
                session=self.sock.session
            )
        return conn, size

class BodFtpService:
    def __init__(self, host: str, username: str, password: str, timeout: int = 30):
        self.host = host
        self.username = username
        self.password = password
        self.timeout = timeout
        self.ftp = None

    def connect(self):
        try:
            self.ftp = PatchedFTP_TLS(timeout=self.timeout)
            self.ftp.connect(self.host)
            self.ftp.login(self.username, self.password)
            self.ftp.prot_p()  # Switch to secure data connection
            logger.info(f"Successfully connected to FTP server {self.host} over TLS")
        except Exception as e:
            logger.error(f"Failed to connect to FTP {self.host}: {str(e)}")
            raise

    def disconnect(self):
        if self.ftp:
            try:
                self.ftp.quit()
            except Exception:
                self.ftp.close()
            self.ftp = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()

    def list_pdfs(self) -> List[str]:
        """List all .pdf files in the current directory"""
        files = []
        try:
            # Use retrlines directly to catch and suppress SSLEOFError
            self.ftp.retrlines("NLST", files.append)
        except ssl.SSLEOFError:
            pass # Server closed connection without TLS close_notify (common FTP server behavior)
        except Exception as e:
            logger.error(f"Failed to list PDFs on {self.host}: {str(e)}")
            return []
            
        return [f for f in files if f.lower().endswith('.pdf')]

    def download_file(self, remote_filename: str, local_path: str):
        """Download a file from FTP to the local path"""
        try:
            with open(local_path, 'wb') as f:
                self.ftp.retrbinary(f"RETR {remote_filename}", f.write)
            logger.info(f"Downloaded {remote_filename} to {local_path}")
        except ssl.SSLEOFError:
            logger.info(f"Downloaded {remote_filename} to {local_path} (suppressed SSLEOFError)")
        except Exception as e:
            logger.error(f"Failed to download {remote_filename}: {str(e)}")
            if os.path.exists(local_path):
                os.remove(local_path)
            raise

    def upload_file(self, local_path: str, remote_filename: str):
        """Upload a local file to the FTP server"""
        try:
            with open(local_path, 'rb') as f:
                self.ftp.storbinary(f"STOR {remote_filename}", f)
            logger.info(f"Uploaded {local_path} to {remote_filename}")
        except Exception as e:
            logger.error(f"Failed to upload {local_path}: {str(e)}")
            raise
