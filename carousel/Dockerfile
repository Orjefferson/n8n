FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY templates ./templates

RUN mkdir -p /app/data/drafts && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "server.js"]
