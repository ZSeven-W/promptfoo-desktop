FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm install -g promptfoo

COPY . .

EXPOSE 3847

CMD ["node", "server.js"]
