.PHONY: all install build start seed health test test-coverage clean docker-build docker-up docker-down

all: install build test

install:
	@echo "Zero external runtime dependencies required. Node.js standard runtime active."

build:
	@echo "Compiling and validating domain schemas..."
	node scripts/build-full-codebase.js
	node scripts/build-enterprise-schemas.js
	node scripts/build-domain-calculators.js

start:
	node scripts/start-all.js

seed:
	node scripts/seed-data.js

health:
	node scripts/health-check.js

test:
	node tests/integration/run-all-tests.js

test-coverage:
	node tests/run-coverage.js

docker-build:
	docker build -t enterprise-microservices:latest .

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

clean:
	rm -rf data/*.tmp* logs/*.log
