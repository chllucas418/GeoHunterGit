function parseGoogleName(fullName) {
    // Regex for: (2A01) Chan Tai Man
    const regex = /^\((?<class>\d[A-Za-z])(?<number>\d+)\)\s*(?<name>.+)$/;
    const match = fullName.match(regex);

    if (match) {
        return {
            classGrade: match.groups.class.toUpperCase(),
            classNumber: parseInt(match.groups.number),
            displayName: match.groups.name.trim()
        };
    }

    return {
        displayName: fullName.trim()
    };
}

// Test cases
console.log(parseGoogleName("(2A01) Chan Tai Man"));
console.log(parseGoogleName("(4C15) Lee Xiao Long"));
console.log(parseGoogleName("Chan Tai Man"));
console.log(parseGoogleName("(2a05) Wong Siu Ming"));
