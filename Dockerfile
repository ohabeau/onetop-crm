FROM node:22-alpine
ENV TZ=Asia/Seoul NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "start"]
