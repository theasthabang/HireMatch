# Frontend Dockerfile — multi-stage build
# Stage 1: build the Vite/React app with Node
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_URL must be provided at BUILD time, not run time -- Vite bakes
# env vars into the compiled JS. Pass it via `docker build --build-arg`.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# Stage 2: serve the built static files with nginx (small, fast, production-appropriate)
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]