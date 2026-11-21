FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY client/package.json ./client/
RUN npm install --prefix client
COPY client ./client
RUN npm --prefix client run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY --from=builder /app/client/dist ./client/dist
EXPOSE 4000
CMD ["node", "server/index.js"]
