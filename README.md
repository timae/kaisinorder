# Kaisin team lunch

A small app for collecting team lunch orders. People open a link and enter their name and a
signature or create-your-own bowl. When you're ready, you finalize the round and get **Kaisin's
own order form** (`assets/OrderForm_RegLarge.pdf`) back, filled in. Attach it to an email to
info@kaisin.ch.

- **Order page** `/`: name, size, signature bowl or custom bowl (protein, base, up to 4 toppings,
  sauce, up to 2 finishes) and an optional note. People can edit or remove their own order (tracked in
  their browser) until the deadline or until you finalize.
- **Organiser page** `/admin` (password protected): open rounds (delivery date/time plus an optional
  order deadline), share the link, see the orders, fill in the contact page, finalize, download the PDF,
  open a pre-written email draft.

Stack: Node 22, Express, PostgreSQL (`pg`), `pdf-lib`. No build step.

## How the PDF is filled

The original fillable PDF is filled field by field, so the layout is exactly Kaisin's.

| Form | Filled with |
| --- | --- |
| Page 1 quantity fields | Count of each signature bowl, regular and large |
| Page 1 "Total of bowls" | Number of signature bowls (the PDF field is named `TOTAL OF SIGNATURE BOWLS`) |
| Page 1 extras / notes | Cutlery, chopsticks and napkins checkboxes; notes line |
| Page 2 slots | Create-your-own bowls. **Identical bowls are merged** into one slot with a quantity, and the slot's "Name your bowl" lists everyone who ordered it |
| Page 3 | Contact info, delivery date/time, addresses, notes |

The form only has 8 create-your-own slots. If there are more than 8 different custom bowls, extra
page-2 copies are added after page 2 (those extra pages are flattened). The notes line marks them
"page x of y". With up to 8 custom bowls the PDF stays fillable, so you can still change it in a PDF
viewer before you send it.

Kaisin's terms ask for the create-your-own bowls to also be listed in the email. The email draft on
the organiser page does that.

Drinks and powerballs aren't collected. You can still pick them in the downloaded PDF.

## Deploy on Deploio

You need [`nctl`](https://docs.nine.ch/docs/nctl/) and this folder pushed to a Git repository.

```bash
# 1. Database (PostgreSQL Economy, from CHF 5.50/month)
nctl create postgresdatabase kaisin-lunch-db

# 2. App, built from the Dockerfile, linked to the database via a service reference
#    (injects NINE_PGDB_DB_* env vars)
nctl create app kaisin-lunch \
  --git-url=https://github.com/<you>/kaisin-lunch \
  --dockerfile \
  --env=ADMIN_PASSWORD='<choose-a-strong-password>' \
  --service db=postgresdatabase/kaisin-lunch-db
```

The `Dockerfile` (Node 22 Alpine, production dependencies only, runs as the unprivileged `node`
user, `TZ=Europe/Zurich` built in) is used because of `--dockerfile`. In Cockpit, turn on the
**Dockerfile Build** switch instead. If the app lives in a subfolder of your repo, also set
`--git-sub-path`. Leave out `--dockerfile` to fall back to the Node.js buildpack, which works with the
same code.

To test the image locally:

```bash
docker build -t kaisin-lunch .
docker run --rm -p 8080:8080 \
  -e ADMIN_PASSWORD=dev \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/kaisin \
  kaisin-lunch
```

For a private repo, see [Accessing private repositories](https://docs.nine.ch/docs/deplo-io/configuration/deploio-private-repository-access).

**Database connection.** The app reads, in this order:
1. `DATABASE_URL` (plus an optional `DATABASE_CA_CERT`), or
2. any `NINE_PGDB_<NAME>_DSN` / `NINE_PG_<NAME>_DSN` injected by a Deploio service reference (plus its `_CA_CERT`).

Service references are still beta. If you'd rather not use them, set `DATABASE_URL` yourself from
the database's FQDN, user and password (`nctl get postgresdatabase kaisin-lunch-db --print-user` /
`--print-password`). The database name is the same as the user name:
`postgres://<user>:<password>@<fqdn>:5432/<user>`.

Tables are created automatically on startup. TLS is set up for Nine's self-signed certificates (the
CA is used when it's provided).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes | Password for `/admin` |
| `TZ` | no | Defaults to `Europe/Zurich` in the Docker image. Set it yourself when using the buildpack, so the 24-hour warning uses local time |
| `SESSION_SECRET` | no | Signs the admin cookie (defaults to `ADMIN_PASSWORD`). Changing it logs everyone out |
| `DATABASE_URL` | if no service reference | Postgres connection string |
| `DEFAULT_CONTACT_NAME`, `DEFAULT_COMPANY`, `DEFAULT_PHONE`, `DEFAULT_EMAIL`, `DEFAULT_DELIVERY_ADDRESS`, `DEFAULT_INVOICE_ADDRESS` | no | Pre-fill the contact page for the very first round. Later rounds copy the previous round's contact details |

`PORT` is set by Deploio. The health endpoint is `/healthz`.

## Run locally

```bash
npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kaisin ADMIN_PASSWORD=dev npm start
# http://localhost:8080 and http://localhost:8080/admin
```

## Notes and assumptions

- Prices on the site are estimates. Custom large bowls are assumed to cost +CHF 3.00 (the same as the
  signature bowls). Kaisin's invoice is what counts.
- The organiser page warns, but doesn't block, if the order has fewer than 5 bowls or is less than
  24 hours before delivery (Kaisin's minimums).
- If Kaisin changes the form, replace `assets/OrderForm_RegLarge.pdf` and check the field names in
  `src/pdf.js` and `src/menu.js` (signature `fields`).
