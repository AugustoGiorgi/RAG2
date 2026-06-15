FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js app.js index.html styles.css README.md PRODUCTION.md senior-review-master-prompt.txt ./
COPY --chown=node:node adapters ./adapters
COPY --chown=node:node assets ./assets
COPY --chown=node:node data ./data
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node knowledge_base ./knowledge_base
COPY --chown=node:node review_examples ./review_examples
COPY --chown=node:node templates ./templates
COPY --chown=node:node qbo-connector ./qbo-connector
COPY --chown=node:node tax-loader ./tax-loader

RUN chown -R node:node /app

EXPOSE 8080

USER node

CMD ["npm", "start"]
