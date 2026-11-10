// Server messages shown to the user. Keys must match ./ru.js
export default {
  'auth.required': 'Please sign in',
  'auth.bad_password': 'Wrong password',

  'err.invalid': 'Check the form fields',
  'err.recurring_missing': 'Recurring payment not found',
  'err.rate_limited': 'Too many attempts, wait a minute',
  'err.server': 'Server error',

  'expense.not_found': 'Expense not found',
  'recurring.not_found': 'Payment not found',
  'income.not_found': 'Income not found',

  'csv.header': ['Date', 'Amount', 'Category', 'Note', 'Account'],

  'ai.off': 'AI is not configured: set LLM_PROVIDER and LLM_KEY in .env and restart the containers',
  'ai.unknown_provider': 'Unknown LLM_PROVIDER={name}. Supported: {list}',
  'ai.key_needed': '{provider} needs LLM_KEY',
  'ai.auth': 'Invalid LLM_KEY for {provider}',
  'ai.rate': '{provider} rate limit reached, try again later',
  'ai.conn': 'Cannot reach {provider}{detail}',
  'ai.timeout': 'Cannot reach {provider}: timeout',
  'ai.api': '{provider} API error ({status}){detail}',
  'ai.no_response': 'no response',
  'ai.empty': '{provider} returned an empty response',
  'ai.refusal': '{provider} declined to analyse this data',
  'ai.truncated': 'The {provider} response was cut off — try again',
  'ai.json': '{provider} returned something that is not JSON',

  'bank.off': 'Bank sync is not configured: set EB_APP_ID, EB_PRIVATE_KEY_FILE and EB_REDIRECT_URL in .env and restart the containers',
  'bank.redirect_missing': 'Bank sync: EB_REDIRECT_URL is not set in .env',
  'bank.key': 'Bank sync: cannot read the private key file {file}',
  'bank.auth': 'Enable Banking rejected the application key or id{detail}',
  'bank.redirect': 'The redirect URL {url} is not allowed for the Enable Banking application: add it in their control panel',
  'bank.expired': 'Access to the bank has expired — connect the bank again',
  'bank.rate': 'The bank limits how often data can be requested, try again in a few hours',
  'bank.conn': 'Cannot reach Enable Banking{detail}',
  'bank.timeout': 'Cannot reach Enable Banking: timeout',
  'bank.api': 'Enable Banking error ({status}){detail}',
  'bank.not_found': 'Bank connection not found',
  'bank.period': 'The bank does not return transactions for this period. Check the dates: the end cannot be in the future, and many banks give history older than 90 days only right after connecting{detail}',
};
