const fs = require('fs');
const file = 'src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

const startIndex = content.indexOf('<style>{`');
const endIndex = content.indexOf('`}</style>');

if (startIndex !== -1 && endIndex !== -1) {
    const before = content.substring(0, startIndex);
    let styleBlock = content.substring(startIndex, endIndex);
    const after = content.substring(endIndex);

    // Replace ' - ' with '-'
    // There are no calc() usages in this codebase's CSS or we can handle them manually,
    // but let's check if ' - ' is safe to replace.
    // Actually, there's `0 %, 100 %`, `50 %` injected as well!
    // It added spaces before %: `width: 100 %;`, `border - radius: 50 %;`

    styleBlock = styleBlock.replace(/ - /g, '-');
    styleBlock = styleBlock.replace(/ %/g, '%');

    // Also ' : ' might have been introduced if there are pseudo-classes?
    // Let's check view_file from earlier: `.generate - btn: hover: not(: disabled)`
    // Yes! ` hover: not(: disabled)` -> `:hover:not(:disabled)`
    styleBlock = styleBlock.replace(/: hover/g, ':hover');
    styleBlock = styleBlock.replace(/: disabled/g, ':disabled');
    styleBlock = styleBlock.replace(/: not\(/g, ':not(');
    styleBlock = styleBlock.replace(/: active/g, ':active');
    styleBlock = styleBlock.replace(/: focus/g, ':focus');
    styleBlock = styleBlock.replace(/: before/g, ':before');
    styleBlock = styleBlock.replace(/: after/g, ':after');
    styleBlock = styleBlock.replace(/: checked/g, ':checked');
    styleBlock = styleBlock.replace(/: last-child/g, ':last-child');

    // also @keyframes fadeIn { from { ... } to { ... } }
    // let's just do a big replace

    // also `flex - direction` became `flex-direction`.
    // wait `ease -in -out` -> `ease-in-out`
    styleBlock = styleBlock.replace(/ease-in-out/g, 'ease-in-out'); // replaced above

    // Wait, what about `background - image: url("data:image/...`
    // `background-image: url("data:image/svg+xml,%3Csvg ... `

    // Are there spacing around variables? `var(--blue - accent)` -> `var(--blue-accent)`

    fs.writeFileSync(file, before + styleBlock + after);
    console.log('Fixed CSS in src/App.jsx');
} else {
    console.log('Could not find style block');
}
