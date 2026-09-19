# DermaLens AI web build — Expo Router exported to static files, served by nginx.
# The Android/iOS app is built separately (EAS or a local Gradle build); see
# docs/SELF-HOSTING.md. This image is only the web version of the same code.

FROM node:20-bookworm-slim AS build
WORKDIR /app

# EXPO_PUBLIC_* values are inlined into the JS bundle at export time, so the
# backend URL has to be supplied here — it cannot be changed at container start.
ARG EXPO_PUBLIC_BACKEND_URL
ENV EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL}

COPY package.json ./
COPY yarn.lock* ./
COPY scripts ./scripts
RUN yarn install --network-timeout 600000

COPY . .
RUN npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
