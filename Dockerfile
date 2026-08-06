# ─── Build stage: frontend ─────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Runtime stage: Express server + static files ─────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy built frontend
COPY --from=frontend-build /app/dist ./dist

# Copy server source
COPY server/ ./server/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.js"]
