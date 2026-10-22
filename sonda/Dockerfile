# Sonda del laboratorio (Etapa 0 de la version empresa): imagen chica con
# WireGuard (kernel o wireguard-go), iperf3 y lo justo para juntar resultados.
# No se publica en Docker Hub: va en un .tar.gz que se reparte por Veyon.
FROM alpine:3.20
RUN apk add --no-cache wireguard-tools-wg wireguard-go iperf3 socat iproute2-minimal busybox-extras
COPY imagen/ /sonda/
RUN chmod 755 /sonda/*.sh /sonda/www/cgi-bin/*
ENTRYPOINT ["/sonda/sonda.sh"]
