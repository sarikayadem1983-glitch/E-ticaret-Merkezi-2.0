# Yerel geliştirme için MinIO, kaynaktan derlenir (resmî imajlar artık yayımlanmıyor).
# Yalnızca geliştirme ve test; production'da yönetilen S3 kullanılır.
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z

FROM golang:1.24-alpine AS derleme
ARG MINIO_RELEASE
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/minio .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -H -u 1000 minio && mkdir /data && chown minio /data
COPY --from=derleme /out/minio /usr/local/bin/minio
USER minio
EXPOSE 9000 9001
# Kova, veri klasöründe dizin olarak açılınca MinIO tarafından tanınır.
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p \"/data/${MINIO_BUCKET:-tm-dev}\" && exec minio server /data --console-address :9001"]
