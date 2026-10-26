import { handleDatabaseIpc } from './database-handler'

import {
  addContactFromAddress,
  deleteContact,
  deleteContacts,
  deleteContactGroup,
  listContactGroups,
  listContacts,
  saveContact,
  saveContactGroup
} from '../db/repositories/contact.repository'
import type { ContactGroupInput } from '../../shared/types'
import type { ContactInput } from './types'
import { exportVCardToDisk, importVCardFromDisk } from '../services/vcard'

export function registerContactsIpc(): void {
  handleDatabaseIpc('contacts/list', (_event, search?: string, groupId?: number) =>
    listContacts(search, groupId)
  )
  handleDatabaseIpc(
    'contacts/addFromAddress',
    (_event, input: { displayName: string; email: string }) => addContactFromAddress(input)
  )
  handleDatabaseIpc('contacts/listGroups', () => listContactGroups())
  handleDatabaseIpc('contacts/saveGroup', (_event, input: ContactGroupInput) =>
    saveContactGroup(input)
  )
  handleDatabaseIpc('contacts/deleteGroup', (_event, groupId: number) =>
    deleteContactGroup(groupId)
  )
  handleDatabaseIpc('contacts/save', (_event, input: ContactInput) => saveContact(input))
  handleDatabaseIpc('contacts/delete', (_event, contactId: number) => deleteContact(contactId))
  handleDatabaseIpc('contacts/deleteMany', (_event, contactIds: number[]) =>
    deleteContacts(contactIds)
  )
  handleDatabaseIpc('contacts/importVCard', () => importVCardFromDisk())
  handleDatabaseIpc('contacts/exportVCard', (_event, contactIds?: number[]) =>
    exportVCardToDisk(contactIds)
  )
}
