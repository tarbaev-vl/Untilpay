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
};
