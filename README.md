# Семейный бюджет (self-hosted)

Учёт регулярных платежей (аренда, коммуналка, страховки, подписки) и ежедневных расходов.
Годовые и квартальные платежи пересчитываются в месячную сумму, есть разбивка по категориям,
остаток от дохода и выгрузка месяца в CSV.

**Стек:** Node.js 22 + Fastify 5 · PostgreSQL 16 · nginx · Docker Compose.

```
браузер ──► nginx (:8080) ──► app: Fastify (:3000) ──► PostgreSQL (только внутренняя сеть)
```

## Запуск

Нужен Docker с Compose v2.

```bash
cp .env.example .env
# в .env поменяйте POSTGRES_PASSWORD, APP_PASSWORD и SESSION_SECRET
openssl rand -hex 32        # результат вставьте в SESSION_SECRET

docker compose up -d --build
```

Откройте http://localhost:8080 и войдите с паролем из `APP_PASSWORD`.
Таблицы создаются автоматически при первом старте (миграции из `app/migrations`).

## Обновление

```bash
git pull   # или замените файлы
docker compose up -d --build
```

Новые миграции применятся сами. Данные хранятся в Docker-томе `pgdata` и не теряются при пересборке.

## Резервная копия

```bash
# сохранить
docker compose exec -T db pg_dump -U budget budget | gzip > backup-$(date +%F).sql.gz

# восстановить в пустую базу
gunzip -c backup-2026-10-23.sql.gz | docker compose exec -T db psql -U budget budget
```

Удобно повесить первую команду на cron раз в сутки.

## Доступ извне

Не открывайте порт 8080 в интернет напрямую. Варианты:

- **Только дома:** оставьте как есть, открывайте по IP сервера в локальной сети.
- **Tailscale:** самый простой способ зайти с телефона откуда угодно, без проброса портов.
- **HTTPS-домен:** поставьте перед nginx Caddy, Traefik или Cloudflare Tunnel и задайте
  `COOKIE_SECURE=true` в `.env`.

## API

Все маршруты, кроме `/api/login`, `/api/me` и `/api/health`, требуют входа (кука сессии).

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/login` | `{ "password": "…" }` → кука сессии на 30 дней |
| POST | `/api/logout` | выход |
| GET | `/api/recurring` | все регулярные платежи |
| POST | `/api/recurring` | создать: `name, amount, period (week/month/quarter/year), kind (mandatory/subscription), category, account, day, active` |
| PUT | `/api/recurring/:id` | изменить целиком |
| PATCH | `/api/recurring/:id` | `{ "active": false }` — пауза |
| DELETE | `/api/recurring/:id` | удалить |
| GET | `/api/expenses?month=2026-10` | расходы за месяц |
| GET | `/api/expenses.csv?month=2026-10` | то же в CSV (разделитель `;`, открывается в Excel) |
| POST | `/api/expenses` | создать: `amount, date (YYYY-MM-DD), category, note, account` |
| PUT | `/api/expenses/:id` | изменить |
| DELETE | `/api/expenses/:id` | удалить |
| GET / PUT | `/api/settings` | `{ "income": 3200 }` — доход в месяц |

## Структура

```
docker-compose.yml
.env.example
nginx/default.conf         прокси, gzip, заголовки безопасности (CSP)
app/
  Dockerfile
  package.json
  migrations/001_init.sql  таблицы recurring, expenses, settings
  src/server.js            Fastify, запуск миграций
  src/auth.js              вход по паролю, подписанная кука
  src/routes/*.js          REST API с валидацией JSON Schema
  public/                  интерфейс (HTML + CSS + JS без сборки)
```

## Разработка без Docker

```bash
cd app
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/budget \
SESSION_SECRET=$(openssl rand -hex 32) APP_PASSWORD=dev npm run dev
# http://localhost:3000
```

## Идеи на потом

- Импорт CSV-выписок Revolut и Bank of Cyprus.
- Автосинхронизация с банками через Enable Banking (PSD2) по расписанию.
- Графики по месяцам, лимиты по категориям.
