# Linux SSL/HTTPS Deployment Plan (Certbot & Nginx)

This plan outlines how to configure HTTPS on your Linux server (`10.1.1.18`) using the existing `init-letsencrypt.sh` script, **Certbot**, and **Nginx**.

We identified and resolved a few configurations in the codebase to make this script work seamlessly:
1. **Missing `certbot` Service**: The `docker-compose.yml` was missing a `certbot` service.
2. **Volume Mismatch**: Nginx was mounting `/etc/letsencrypt` (absolute host path) while the script writes to `./certbot/conf` (local project path).

---

## 1. Domain and Network Setup

1. **DNS Mapping**:
   Map your subdomain (e.g., `cms.s4carlisle.com`) to the target server IP `10.1.1.18`.
   * Since `10.1.1.18` is a private network IP, this A record should be created on your **internal DNS server** (e.g. local router or Active Directory DNS) so internal machines can resolve it.
   * **Note**: Let's Encrypt requires port `80` to be open and publicly reachable for HTTP-01 validation. If your server is strictly internal and cannot be reached from the internet, you will need to obtain the certificate via the **DNS-01 challenge** (using a TXT record) instead of `init-letsencrypt.sh`.

2. **Firewall Rules**:
   Ensure ports `80` (HTTP) and `443` (HTTPS) are allowed inbound on the Linux server:
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

---

## 2. Docker Compose Configuration Updates

Update [**`docker-compose.yml`**](file:///d:/Main/cms_backend/docker-compose.yml) to add the missing `certbot` service and align the certificate volume mounts.

### Update `services:` block:

```yaml
  # ── Certbot (Let's Encrypt Client) ────────────────────────────────────────
  certbot:
    image: certbot/certbot
    container_name: cms_certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - certbot_webroot:/var/www/certbot
    depends_on:
      - nginx

  # ── Nginx Reverse Proxy ───────────────────────────────────────────────────
  nginx:
    image: nginx:alpine
    container_name: cms_nginx
    ports:
      - "80:80"        # Map standard HTTP
      - "443:443"      # Map standard HTTPS
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./frontend/dist:/var/www/ui:ro
      - ./certbot/conf:/etc/letsencrypt:ro     # Map local certbot directory (shares certs)
      - certbot_webroot:/var/www/certbot:ro    # Shares webroot challenge path
    depends_on:
      backend:
        condition: service_healthy
      onlyoffice:
        condition: service_started
      collabora:
        condition: service_started
    restart: always
```

---

## 3. Nginx Configuration Updates

Update [**`nginx/nginx.conf`**](file:///d:/Main/cms_backend/nginx/nginx.conf) to enforce SSL and load the certificates correctly:

```nginx
# 1. Redirect HTTP (Port 80) to HTTPS (Port 443)
server {
    listen 80;
    server_name cms.s4carlisle.com;

    # Certbot challenge path (Must remain open on Port 80)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# 2. Secure HTTPS Server Block
server {
    listen 443 ssl;
    server_name cms.s4carlisle.com;

    # SSL Certificate Paths
    ssl_certificate /etc/letsencrypt/live/cms.s4carlisle.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cms.s4carlisle.com/privkey.pem;

    # Recommended TLS Security Configurations (Downloaded by the script)
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # ... Include all other location blocks unchanged (/api/, /wopi/, /webdav/, /) ...

    # ── WebDAV Location ──────────────────────────────────────────────────────
    location ^~ /webdav/ {
        proxy_pass         http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host             $http_host;
        proxy_set_header X-Real-IP        $remote_addr;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https; # Pass secure proto to backend
        proxy_read_timeout    300s;
        proxy_connect_timeout  60s;
        proxy_send_timeout    300s;
        proxy_request_buffering off;
    }
}
```

---

## 4. Environment File (`.env`) Updates

Ensure the environment variables match the secure subdomain:

```env
# ─── Server ──────────────────────────────────────────────────────────────────
HOST_DOMAIN=cms.s4carlisle.com
HOST_PORT=443

# ─── OnlyOffice ──────────────────────────────────────────────────────────────
ONLYOFFICE_PUBLIC_URL=https://cms.s4carlisle.com
ONLYOFFICE_INTERNAL_URL=http://onlyoffice:80
ONLYOFFICE_JWT_ENABLED=false

# ─── Collabora ───────────────────────────────────────────────────────────────
COLLABORA_URL=http://collabora:9980
COLLABORA_PUBLIC_URL=https://cms.s4carlisle.com
WOPI_BASE_URL=http://backend:8000
WEBDAV_BASE_URL=https://cms.s4carlisle.com
```

---

## 5. Deployment Execution (Running the Script)

Once the configurations are placed on your Linux server, run the following steps to initialize SSL:

1. **Make the script executable**:
   ```bash
   chmod +x init-letsencrypt.sh
   ```
2. **Run the script** with your subdomain and email:
   ```bash
   sudo ./init-letsencrypt.sh cms.s4carlisle.com your-email@s4carlisle.com
   ```
   
### What the script will do:
1. Download standard secure TLS parameter configs into `./certbot/conf`.
2. Generate a dummy self-signed certificate so Nginx can start up without failing.
3. Start Nginx on ports 80/443.
4. Remove the dummy certificate and run `certbot certonly --webroot` to verify domain ownership and fetch the real Let's Encrypt certificate.
5. Reload Nginx to activate the real SSL certificate.
