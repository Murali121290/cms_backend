import os
import ssl
import socket
import logging
from ftplib import FTP, FTP_TLS, error_perm, error_temp, error_reply, error_proto, parse150
from typing import List, Optional

logger = logging.getLogger("app.ftp")


class PatchedFTP_TLS(FTP_TLS):
    """
    Enhanced FTP_TLS supporting:
    1. TLS Session Resumption on data connections (required by servers like FileZilla Server,
       Pure-FTPd, and ProFTPd that enforce TLS session reuse).
    2. Explicit FTPS (AUTH TLS) with protected data transfer (PROT P).
    3. Handles passive mode host correction (overcoming unroutable internal NAT IPs returned in PASV).
    4. Reliable data socket closing without unwrap hangs on TLS close.
    """
    def makepasv(self):
        host, port = super().makepasv()
        # In case the FTP server reports an unroutable internal IP (e.g. 10.x.x.x behind NAT)
        # in the PASV response, fallback to the control connection host.
        if self.host:
            return self.host, port
        return host, port

    def ntransfercmd(self, cmd, rest=None):
        size = None
        if self.passiveserver:
            host, port = self.makepasv()
            conn = socket.create_connection(
                (host, port),
                self.timeout,
                source_address=self.source_address
            )
            try:
                if rest is not None:
                    self.sendcmd("REST %s" % rest)
                if self._prot_p:
                    session = getattr(getattr(self, "sock", None), "session", None)
                    conn = self.context.wrap_socket(
                        conn,
                        server_hostname=self.host,
                        session=session
                    )
                resp = self.sendcmd(cmd)
                if resp[0] == '2':
                    resp = self.getresp()
                if resp[0] != '1':
                    raise error_reply(resp)
            except Exception:
                conn.close()
                raise
        else:
            with self.makeport() as sock:
                if rest is not None:
                    self.sendcmd("REST %s" % rest)
                resp = self.sendcmd(cmd)
                if resp[0] == '2':
                    resp = self.getresp()
                if resp[0] != '1':
                    raise error_reply(resp)
                conn, sockaddr = sock.accept()
                if self.timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                    conn.settimeout(self.timeout)
                if self._prot_p:
                    session = getattr(getattr(self, "sock", None), "session", None)
                    conn = self.context.wrap_socket(
                        conn,
                        server_hostname=self.host,
                        session=session
                    )
        if resp[:3] == '150':
            size = parse150(resp)
        return conn, size

    def storbinary(self, cmd, fp, blocksize=8192, callback=None, rest=None):
        self.voidcmd('TYPE I')
        with self.transfercmd(cmd, rest) as conn:
            while 1:
                buf = fp.read(blocksize)
                if not buf:
                    break
                conn.sendall(buf)
                if callback:
                    callback(buf)
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
        return self.voidresp()

    def retrbinary(self, cmd, callback, blocksize=8192, rest=None):
        self.voidcmd('TYPE I')
        with self.transfercmd(cmd, rest) as conn:
            while 1:
                data = conn.recv(blocksize)
                if not data:
                    break
                callback(data)
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
        return self.voidresp()


class BodFtpService:
    """
    Books on Demand (BOD) FTP service supporting:
    - Explicit FTPS (FTP over TLS via AUTH TLS on port 21)
    - Optional plain FTP fallback if use_tls=False
    - Configurable passive / active mode
    - Strict TLS certificate verification via ssl.create_default_context() with optional CA bundle or self-signed cert tolerance
    - Encrypted control and data connections via PROT P
    """
    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        port: int = 21,
        timeout: int = 30,
        use_tls: bool = True,
        passive: bool = True,
        ssl_verify: Optional[bool] = None,
        ca_file: Optional[str] = None
    ):
        self.host = host
        self.username = username
        self.password = password
        self.port = port or 21
        self.timeout = timeout or 30
        self.use_tls = use_tls
        self.passive = passive
        self.ca_file = ca_file
        
        # If ssl_verify is not explicitly passed, inspect environment / settings
        if ssl_verify is None:
            from app.core.config import get_settings
            try:
                settings = get_settings()
                self.ssl_verify = getattr(settings, "BOD_FTP_SSL_VERIFY", True)
                if not self.ca_file:
                    self.ca_file = getattr(settings, "BOD_FTP_CA_FILE", None) or None
            except Exception:
                self.ssl_verify = True
        else:
            self.ssl_verify = ssl_verify

        self.ftp: Optional[FTP_TLS | FTP] = None

    def _create_ssl_context(self) -> ssl.SSLContext:
        """Create and configure SSL context using ssl.create_default_context()."""
        if self.ca_file and os.path.isfile(self.ca_file):
            context = ssl.create_default_context(cafile=self.ca_file)
        else:
            context = ssl.create_default_context()

        if not self.ssl_verify:
            # When verification is explicitly disabled (e.g. self-signed internal testing servers)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            logger.warning(f"SSL certificate verification is disabled for FTP {self.host}:{self.port}")
        else:
            context.check_hostname = True
            context.verify_mode = ssl.CERT_REQUIRED

        return context

    def connect(self):
        """Establish connection and authenticate using Explicit FTPS."""
        if not self.host:
            raise ValueError("FTP host is not configured.")

        clean_host = self.host.strip()
        logger.info(f"Connecting to FTP server {clean_host}:{self.port} (TLS={self.use_tls}, Passive={self.passive}, VerifySSL={self.ssl_verify})...")

        try:
            if self.use_tls:
                ssl_context = self._create_ssl_context()
                self.ftp = PatchedFTP_TLS(context=ssl_context, timeout=self.timeout)
                # 1. Connect TCP control socket on port 21
                self.ftp.connect(clean_host, port=self.port, timeout=self.timeout)

                # 2. Upgrade control connection with Explicit FTPS (AUTH TLS)
                try:
                    self.ftp.auth()
                except ssl.SSLCertVerificationError as ssl_err:
                    logger.error(f"TLS certificate verification failed for {clean_host}:{self.port}: {ssl_err}")
                    raise
                except Exception as auth_err:
                    logger.error(f"Explicit FTPS AUTH TLS negotiation failed on {clean_host}:{self.port}: {auth_err}")
                    raise

                # 3. Authenticate credentials securely over TLS
                try:
                    self.ftp.login(self.username, self.password)
                except error_perm as perm_err:
                    logger.error(f"FTP authentication failed for user '{self.username}' on {clean_host}:{self.port}: {perm_err}")
                    raise

                # 4. Switch data channel to encrypted mode (PROT P)
                try:
                    self.ftp.prot_p()
                except Exception as prot_err:
                    logger.error(f"Failed to enable protected data connection (PROT P) on {clean_host}: {prot_err}")
                    raise

                # 5. Set passive mode
                self.ftp.set_pasv(self.passive)

                logger.info(f"Successfully established Explicit FTPS connection and authenticated with {clean_host}:{self.port} (PROT P enabled)")
            else:
                self.ftp = FTP(timeout=self.timeout)
                self.ftp.connect(clean_host, port=self.port, timeout=self.timeout)
                self.ftp.login(self.username, self.password)
                self.ftp.set_pasv(self.passive)
                logger.info(f"Successfully connected to plain FTP server {clean_host}:{self.port}")

        except (ssl.SSLCertVerificationError, error_perm):
            self.disconnect()
            raise
        except Exception as e:
            logger.error(f"Failed to connect or authenticate to FTP {clean_host}:{self.port}: {str(e)}")
            self.disconnect()
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
