FROM node:22-alpine
ENV TZ=Asia/Seoul NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# /data 는 Railway Volume(또는 docker run -v)으로 마운트
EXPOSE 3000
CMD ["npm", "start"]
