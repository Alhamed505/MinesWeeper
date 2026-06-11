# MinesWeeper — static site, no build step (plain HTML/CSS/JS).
# A tiny Node static server ('serve') hosts the files; Railway
# injects $PORT at runtime, which we bind to 0.0.0.0.
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s . -l tcp://0.0.0.0:${PORT}"]
