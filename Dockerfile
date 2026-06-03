FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js app.js index.html styles.css README.md PRODUCTION.md senior-review-master-prompt.txt ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node knowledge_base ./knowledge_base
COPY --chown=node:node review_examples ./review_examples

EXPOSE 8080

USER node

CMD ["npm", "start"]
