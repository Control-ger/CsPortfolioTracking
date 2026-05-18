FROM node:22-alpine AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY vite.config.js jsconfig.json postcss.config.js tailwind.config.js ./

RUN npm ci
RUN npm run build:web

FROM php:8.2-apache

# Mod Rewrite aktivieren
RUN a2enmod rewrite

# Apache VirtualHost konfigurieren (Achte auf das *:80)
RUN echo '<VirtualHost *:80>\n\
    DocumentRoot /var/www/html\n\
    <Directory /var/www/html>\n\
        AllowOverride All\n\
        Require all granted\n\
    </Directory>\n\
    <Directory /var/www/html/api>\n\
        AllowOverride All\n\
        Require all granted\n\
    </Directory>\n\
    <Directory /var/www/html/api/public>\n\
        AllowOverride All\n\
        Require all granted\n\
    </Directory>\n\
</VirtualHost>' > /etc/apache2/sites-available/000-default.conf

RUN apt-get update && \
    apt-get install -y libcurl4-openssl-dev supervisor && \
    docker-php-ext-install pdo pdo_mysql curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /var/log/supervisor

COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY backend /var/www/html/api
COPY --from=web-build /app/dist /var/www/html
COPY apps/web/public/.htaccess /var/www/html/.htaccess

# Die Runtime-Konfiguration kommt bei Deployment ueber bind-mount /var/www/html/.env.
RUN touch /var/www/html/.env

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
