# Loan Planner

A responsive, browser-based loan amortization calculator with support for dated extra payments.

## Features

- Configurable loan amount, interest rate, term in years and months, payment frequency, and first payment date
- Live payment, interest, payoff date, and payment-count summaries
- Full amortization schedule
- Multiple dated extra payments with automatic schedule recalculation
- Interest and time-saved comparison
- CSV schedule export
- Browser-local persistence and reset controls

## Run locally

The application is plain HTML, CSS, and JavaScript with no build step.

1. Open the `dist` directory.
2. Serve it with any static web server, for example `python -m http.server 8000`.
3. Visit `http://localhost:8000`.

Opening `dist/index.html` directly also works in most browsers.

## Deployment

Publish the contents of `dist/` with any static host, including GitHub Pages or Cloudflare Pages.

## Data and authentication

Loan inputs and extra payments are stored in the visitor's browser using `localStorage`. They are not synchronized between devices or users. The application itself does not provide authentication; configure access through the selected hosting provider if required.

## Calculation convention

The calculator uses the nominal annual interest rate divided by the selected number of payment periods per year. Extra payments are applied on the first scheduled payment date on or after the entered date.

This is a planning tool. Confirm the lender's interest and payment-processing conventions before relying on its results.

