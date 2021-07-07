FROM node:15-slim
WORKDIR /app
COPY ./package*.json ./
COPY ./tsconfig.json ./
COPY ./src ./src
RUN npm install
RUN npm run build


FROM node:15-slim
WORKDIR /app
COPY ./package*.json ./
RUN npm install --only=production
COPY --from=0 /app/dist ./dist

COPY ./bin/serum-vial.js ./bin/serum-vial.js
# run it
CMD ./bin/serum-vial.js
