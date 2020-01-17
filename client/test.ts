import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// const rootPath = vs.workspace.rootPath
const workspacePath = '/Users/buremba/Code/rakam-subproject/rakam-recipes'
const filePath = '/Users/buremba/Code/rakam-subproject/rakam-recipes/firebase/test/test.jsonnet'

let currentPath = path.dirname(filePath);
let configFile = null
while (workspacePath != currentPath && currentPath !== '/') {
    const file = path.join(currentPath, "_config.jsonnet")
    if (fs.existsSync(file)) {
        configFile = file
        break
    }
    // get the parent path
    currentPath = path.join(currentPath, '..')
}

if (configFile != null) {
    try {
        // const jsonOutput = execSync(`${jsonnet.executable} ${configFile}`).toString();
        const jsonOutput = execSync(`jsonnet ${configFile}`).toString();
        const variables = JSON.parse(jsonOutput).variables || {}
        const extCodes = {}
        Object.keys(variables).forEach(variableName => {
            extCodes[variableName] = example_values[variables[variableName].type]
        })
        return extCodes
    } catch (error) {
        // ignore it as config file is not valid
    }
}
