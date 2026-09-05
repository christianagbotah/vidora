const fs = require('fs');
const path = 'src/app/page.tsx';
let text = fs.readFileSync(path, 'utf8');
const from = `            <Button variant="outline" className="flex-1" onClick={onContinue}>
              Back to Project
            </Button>`;
const to = `            <Button variant="outline" className="flex-1" onClick={onBack}>
              Back to Project
            </Button>`;
const count = text.split(from).length - 1;
if (count !== 1) throw new Error(`failed Back button: expected 1 match, found ${count}`);
text = text.replace(from, to);
fs.writeFileSync(path, text);
