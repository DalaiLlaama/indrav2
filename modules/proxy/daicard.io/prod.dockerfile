FROM alpine:3.10

RUN apk add --update --no-cache bash certbot curl iputils nginx openssl && \
    openssl dhparam -out /etc/ssl/dhparam.pem 2048 && \
    ln -fs /dev/stdout /var/log/nginx/access.log && \
    ln -fs /dev/stdout /var/log/nginx/error.log

COPY ops/wait-for.sh /root/wait-for.sh
COPY modules/proxy/daicard.io/prod.conf /etc/nginx/nginx.conf
COPY modules/proxy/daicard.io/entry.sh /root/entry.sh

ENTRYPOINT ["bash", "/root/entry.sh"]
