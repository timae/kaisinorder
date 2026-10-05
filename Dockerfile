# Kaisin team lunch – production image for Deploio (Dockerfile build)
FROM node:22-alpine

# tzdata so TZ=Europe/Zurich is honoured (24h deadline warning uses local time)
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    TZ=Europe/Zurich \
    PORT=8080

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code (see .dockerignore)
COPY server.js ./
COPY src ./src
COPY public ./public
COPY assets ./assets

# Run as the unprivileged user shipped with the node image
USER node

# Deploio injects PORT (default 8080); the app listens on it
EXPOSE 8080

CMD ["node", "server.js"]
