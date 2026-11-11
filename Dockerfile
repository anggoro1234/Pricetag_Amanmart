# Production Multi-Stage Dockerfile for AWS, GCP, Cloud Run or Docker deployments
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 3000
CMD ["nginx", "-g", "daemon off;"]
