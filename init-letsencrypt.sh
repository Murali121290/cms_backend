#!/bin/bash

# Determine docker-compose command
if docker compose version >/dev/null 2>&1; then
  docker_compose="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  docker_compose="docker-compose"
else
  echo 'Error: Neither "docker compose" nor "docker-compose" is installed.' >&2
  exit 1
fi

domains=(inkflow.s4carlisle.com)
rsa_key_size=4096
data_path="./certbot"
email="muraliba@s4carlisle.com"
staging=0 # Set to 1 if you're testing to avoid hitting Let's Encrypt rate limits

if [ -d "$data_path" ] && [ -d "$data_path/conf/live" ]; then
  read -p "Existing certificate data found for $domains. Continue and replace existing certificate? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi

if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo "### Downloading recommended TLS parameters..."
  mkdir -p "$data_path/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$data_path/conf/ssl-dhparams.pem"
  echo
fi

echo "### Creating dummy certificate for $domains using OpenSSL..."
path="/etc/letsencrypt/live/$domains"
mkdir -p "$data_path/conf/live/$domains"
$docker_compose run --entrypoint \
  "openssl req -x509 -nodes -newkey rsa:$rsa_key_size -days 1\
    -keyout '$path/privkey.pem' \
    -out '$path/fullchain.pem' \
    -subj '/CN=localhost'" certbot
echo

echo "### Starting nginx..."
$docker_compose up --force-recreate -d nginx
echo

echo "### Deleting dummy certificate for $domains..."
$docker_compose run --entrypoint \
  "rm -Rf /etc/letsencrypt/live/$domains && \
   rm -Rf /etc/letsencrypt/archive/$domains && \
   rm -Rf /etc/letsencrypt/renewal/$domains.conf" certbot
echo

echo "### Requesting Let's Encrypt certificate for $domains..."
# Join $domains to -d args
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# Select appropriate email arg
email_arg="--register-unsafely-without-email"
if [ -n "$email" ]; then
  email_arg="--email $email --no-eff-email"
fi

# Enable staging mode if needed
staging_arg=""
if [ $staging != "0" ]; then staging_arg="--staging"; fi

$docker_compose run --entrypoint \
  "certbot certonly --webroot -w /var/www/certbot \
    $staging_arg \
    $email_arg \
    $domain_args \
    --rsa-key-size $rsa_key_size \
    --agree-tos \
    --force-renewal" certbot
echo

echo "### Reloading nginx..."
$docker_compose exec nginx nginx -s reload
