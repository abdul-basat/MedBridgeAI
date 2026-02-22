const fs = require('fs');
const file = 'src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

const startIndex = content.indexOf('<style>{`');
const endIndex = content.indexOf('`}</style>');

if (startIndex !== -1 && endIndex !== -1) {
    const before = content.substring(0, startIndex);
    let styleBlock = content.substring(startIndex, endIndex);
    const after = content.substring(endIndex);

    // General hyphens
    styleBlock = styleBlock.replace(/ - /g, '-');
    styleBlock = styleBlock.replace(/ %/g, '%');

    // Specific spacing fixes
    styleBlock = styleBlock.replace(/: hover/g, ':hover');
    styleBlock = styleBlock.replace(/: disabled/g, ':disabled');
    styleBlock = styleBlock.replace(/: not\(/g, ':not(');
    styleBlock = styleBlock.replace(/: active/g, ':active');
    styleBlock = styleBlock.replace(/: focus/g, ':focus');
    styleBlock = styleBlock.replace(/: before/g, ':before');
    styleBlock = styleBlock.replace(/: after/g, ':after');
    styleBlock = styleBlock.replace(/: checked/g, ':checked');
    styleBlock = styleBlock.replace(/: last-child/g, ':last-child');

    styleBlock = styleBlock.replace(/ease -in -out/g, 'ease-in-out');
    styleBlock = styleBlock.replace(/border - /g, 'border-');
    styleBlock = styleBlock.replace(/color: transparent;/g, 'color: transparent;'); // safe

    // Fix variables
    styleBlock = styleBlock.replace(/var\(--([a-z]+) - ([a-z]+)\)/g, 'var(--$1-$2)');

    // Fix some grid formats: 'grid - template - columns'
    styleBlock = styleBlock.replace(/grid-template-columns/g, 'grid-template-columns');

    // Some `flex-direction` might be `flex - direction`
    styleBlock = styleBlock.replace(/flex - direction/g, 'flex-direction');
    styleBlock = styleBlock.replace(/flex-direction/g, 'flex-direction'); // was already mostly fixed

    // Fix media query 'max - width'
    styleBlock = styleBlock.replace(/max - width/g, 'max-width');

    // Fix font - family, font - size, font - weight
    styleBlock = styleBlock.replace(/font - /g, 'font-');

    // Any left over ' - ' like 'align - items' or 'justify - content' or 'text - align'
    // Actually `.replace(/ - /g, '-')` covers all these!

    fs.writeFileSync(file, before + styleBlock + after);
    console.log('Fixed CSS in src/App.jsx');
} else {
    console.log('Could not find style block');
}
