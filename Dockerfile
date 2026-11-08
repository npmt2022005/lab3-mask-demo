FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
COPY public ./public
COPY model_yolo_nano ./model_yolo_nano
COPY model_yolo ./model_yolo
ENV PORT=8080 MODEL_BACKEND=yolo MODEL_FOLDER=model_yolo_nano EXECUTION_LOCATION=cloud ORT_NUM_THREADS=1
EXPOSE 8080
CMD ["npm", "start"]
