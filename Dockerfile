# ANU on a Hugging Face Space (free CPU hardware). The data is read from the published
# JSON API at runtime, so none is baked into the image. Model keys come from Space secrets.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build && mkdir -p .hf-cache && chown -R 1000:1000 /app
USER 1000
ENV HOST=0.0.0.0 \
    PORT=7860 \
    ANU_DATA_URL=https://johnnyohay.github.io/anu/api/v1/all.json
EXPOSE 7860
CMD ["npx", "tsx", "src/server.ts"]
