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
    def __init__(self, host: str, username: str, password: str, port: int = 21, timeout: int = 30):
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.timeout = timeout
        self.ftp = None

    def connect(self):
        try:
            self.ftp = PatchedFTP_TLS(timeout=self.timeout)
            self.ftp.connect(self.host, port=self.port)
            self.ftp.login(self.username, self.password)
            self.ftp.prot_p()  # Switch to secure data connection
            logger.info(f"Successfully connected to FTP server {self.host}:{self.port} over TLS")
        except Exception as e:
            logger.error(f"Failed to connect to FTP {self.host}:{self.port}: {str(e)}")
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

    def list_files(self) -> List[str]:
        """List all files in the current directory"""
        files = []
        try:
            self.ftp.retrlines("NLST", files.append)
        except ssl.SSLEOFError:
            pass
        except Exception as e:
            logger.error(f"Failed to list files on {self.host}: {str(e)}")
            return []
        return files

    def list_pdfs(self) -> List[str]:
        """List all .pdf files in the current directory"""
        files = self.list_files()
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
        except ssl.SSLEOFError:
            logger.info(f"Uploaded {local_path} to {remote_filename} (suppressed SSLEOFError)")
        except Exception as e:
            logger.error(f"Failed to upload {local_path}: {str(e)}")
            raise

    def ensure_dir(self, remote_dir: str):
        """Create remote directory structure if it doesn't exist and navigate into it."""
        try:
            self.ftp.cwd("/")
            parts = [p for p in remote_dir.split('/') if p]
            for part in parts:
                try:
                    self.ftp.cwd(part)
                except Exception:
                    try:
                        self.ftp.mkd(part)
                        self.ftp.cwd(part)
                    except Exception as e:
                        logger.error(f"Failed to create or change to directory {part}: {e}")
                        raise
        except Exception as e:
            logger.error(f"Failed to ensure directory {remote_dir}: {e}")
            raise

    def rename_or_move(self, from_path: str, to_path: str, overwrite: bool = True):
        """Move or rename a remote file/directory on the FTP server. If target exists and overwrite is True, delete target first."""
        try:
            if overwrite:
                try:
                    self.ftp.delete(to_path)
                    logger.info(f"Target '{to_path}' already existed on FTP; deleted before moving.")
                except Exception:
                    pass  # Target didn't exist or wasn't a file, proceed with rename
            self.ftp.rename(from_path, to_path)
            logger.info(f"Moved remote file from '{from_path}' to '{to_path}'")
        except Exception as e:
            # If standard rename failed due to existing file (e.g. 553), attempt delete and rename once more
            if overwrite and "553" in str(e):
                try:
                    self.ftp.delete(to_path)
                    self.ftp.rename(from_path, to_path)
                    logger.info(f"Replaced remote file '{to_path}' with '{from_path}' after clearing existing file.")
                    return
                except Exception as retry_err:
                    logger.error(f"Failed retry replace '{from_path}' to '{to_path}': {retry_err}")
            logger.error(f"Failed to move remote file '{from_path}' to '{to_path}': {e}")
            raise
