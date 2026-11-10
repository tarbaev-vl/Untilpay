// Server messages shown to the user. Keys must match ./en.js
export default {
  'auth.required': 'Нужно войти',
  'auth.bad_password': 'Неверный пароль',

  'err.invalid': 'Проверьте поля формы',
  'err.recurring_missing': 'Регулярный платёж не найден',
  'err.rate_limited': 'Слишком много попыток, подождите минуту',
  'err.server': 'Ошибка сервера',

  'expense.not_found': 'Расход не найден',
  'recurring.not_found': 'Платёж не найден',
  'income.not_found': 'Доход не найден',

  'csv.header': ['Дата', 'Сумма', 'Категория', 'Комментарий', 'Счёт'],

  'ai.off': 'AI не настроен: задайте LLM_PROVIDER и LLM_KEY в .env и перезапустите контейнеры',
  'ai.unknown_provider': 'Неизвестный LLM_PROVIDER={name}. Допустимые: {list}',
  'ai.key_needed': 'Для {provider} нужен LLM_KEY',
  'ai.auth': 'Неверный LLM_KEY для {provider}',
  'ai.rate': 'Лимит запросов к {provider} исчерпан, попробуйте позже',
  'ai.conn': 'Нет связи с {provider}{detail}',
  'ai.timeout': 'Нет связи с {provider}: таймаут',
  'ai.api': 'Ошибка {provider} API ({status}){detail}',
  'ai.no_response': 'нет ответа',
  'ai.empty': '{provider} вернул пустой ответ',
  'ai.refusal': '{provider} отказался анализировать эти данные',
  'ai.truncated': 'Ответ {provider} оборвался — попробуйте ещё раз',
  'ai.json': '{provider} вернул не JSON',

  'bank.off': 'Синхронизация с банком не настроена: задайте EB_APP_ID, EB_PRIVATE_KEY_FILE и EB_REDIRECT_URL в .env и перезапустите контейнеры',
  'bank.redirect_missing': 'Синхронизация с банком: в .env не задан EB_REDIRECT_URL',
  'bank.key': 'Синхронизация с банком: не удалось прочитать файл приватного ключа {file}',
  'bank.auth': 'Enable Banking не принял ключ или идентификатор приложения{detail}',
  'bank.redirect': 'Адрес возврата {url} не разрешён для приложения Enable Banking: добавьте его в их панели управления',
  'bank.expired': 'Доступ к банку истёк — подключите банк заново',
  'bank.rate': 'Банк ограничивает частоту запросов, попробуйте через несколько часов',
  'bank.conn': 'Нет связи с Enable Banking{detail}',
  'bank.timeout': 'Нет связи с Enable Banking: таймаут',
  'bank.api': 'Ошибка Enable Banking ({status}){detail}',
  'bank.not_found': 'Подключение к банку не найдено',
};
