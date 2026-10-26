import { handleDatabaseIpc } from './database-handler'

import {
  getTranslationSettings,
  updateTranslationSettings
} from '../db/repositories/settings.repository'
import { translateMailText } from '../services/mail-translation'
import type { TranslationRequest, TranslationSettings } from './types'

export function registerTranslationIpc(): void {
  handleDatabaseIpc('translations/getSettings', () => getTranslationSettings())
  handleDatabaseIpc('translations/updateSettings', (_event, input: TranslationSettings) =>
    updateTranslationSettings(input)
  )
  handleDatabaseIpc('translations/translate', (_event, input: TranslationRequest) =>
    translateMailText(input)
  )
}
