# Enterprise Microservices Platform Dockerfile
# Zero-dependency Node.js runtime environment

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Copy entire application source code
COPY . .

# Ensure permissions
RUN chmod +x scripts/*.js

# Expose all microservices ports
EXPOSE 8000 8001 8002 8003 8004 8005 8006 8007 8008 9000 9001

# Healthcheck configuration
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node scripts/health-check.js || exit 1

# Default runtime entrypoint
CMD ["npm", "start"]
