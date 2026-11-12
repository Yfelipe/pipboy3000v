// The ID card designs on the "ID, lists & notes" page. Pure data, so tests can check it.
// labels: the five rows of the card's details panel (the form's Name, Room, Date of birth, Skill
// and Vault fields, in that order). emblem: a picture from assets/official drawn in place of the
// barcode; null keeps the barcode. Keep labels to 6 characters: the column is 70 px wide.
export const ID_TEMPLATES = Object.freeze([
  { id: 'dweller', name: 'Vault dweller', title: 'DWELLER IDENTIFICATION', labels: ['NAME', 'ROOM', 'DOB', 'SKILL', 'VAULT'], footer: 'ISSUED 2077', emblem: null },
  { id: 'vaulttec', name: 'Vault-Tec employee', title: 'VAULT-TEC EMPLOYEE PASS', labels: ['NAME', 'DESK', 'DOB', 'DEPT', 'BRANCH'], footer: 'VAULT-TEC CORP.', emblem: '/assets/official/Vault-Tec_Circle.png' },
  { id: 'ncr', name: 'NCR trooper', title: 'NCR MILITARY IDENTIFICATION', labels: ['NAME', 'UNIT', 'DOB', 'RANK', 'POST'], footer: 'N.C.R.', emblem: '/assets/official/fallout-ncr-flag.png' },
  { id: 'legion', name: 'Caesar’s Legion', title: 'LEGION OF CAESAR', labels: ['NAME', 'COHORT', 'DOB', 'RANK', 'CAMP'], footer: 'AVE', emblem: '/assets/official/fallout-legion-vexillum.svg' },
  { id: 'enclave', name: 'Enclave officer', title: 'ENCLAVE PERSONNEL FILE', labels: ['NAME', 'UNIT', 'DOB', 'RANK', 'BASE'], footer: 'U.S. GOVT.', emblem: '/assets/official/fallout-enclave.png' },
  { id: 'brotherhood', name: 'Brotherhood of Steel', title: 'BROTHERHOOD OF STEEL', labels: ['NAME', 'SQUAD', 'DOB', 'RANK', 'POST'], footer: 'AD VICTORIAM', emblem: '/assets/official/fallout-brotherhood-of-steel.svg' },
]);

export const idTemplate = (id) => ID_TEMPLATES.find((t) => t.id === id) ?? ID_TEMPLATES[0];

/** "COHORT" -> "Cohort" for the form; DOB stays a date of birth. */
export const fieldLabel = (label) => (label === 'DOB' ? 'Date of birth' : label[0] + label.slice(1).toLowerCase());
