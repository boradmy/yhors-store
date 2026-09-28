FROM node:22-alpine
WORKDIR /app

# Motor de imágenes requerido por los PDF de flyers (JPG/PNG/WEBP/GIF -> JPEG).
RUN apk add --no-cache imagemagick

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV YHORS_STORAGE_DIR=/var/data/yhors
EXPOSE 3000
VOLUME ["/var/data"]
CMD ["npm", "start"]
