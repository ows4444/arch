install:
	npm install

build:
	npm run build

start:
	npm run start

dev:
	npm run start:dev

lint:
	npm run lint

format:
	npm run format

test:
	npm test

clean:
	npm run clean

typecheck:
	npm run typecheck

check:
	npm run typecheck
	npm run lint
	npm test

compose-up:
	docker compose -f docker/compose/compose.yml up -d

compose-down:
	docker compose -f docker/compose/compose.yml down

compose-logs:
	docker compose -f docker/compose/compose.yml logs -f
