import addressParser from 'nodemailer/lib/addressparser'

export function parseMailAddresses(value: string): Array<{ displayName: string; email: string }> {
  return addressParser(value, { flatten: true }).map((address) => ({
    displayName: address.name,
    email: address.address
  }))
}

export function mailboxKey(value: string): string {
  return parseMailAddresses(value)[0]?.email.trim().toLowerCase() ?? value.trim().toLowerCase()
}
