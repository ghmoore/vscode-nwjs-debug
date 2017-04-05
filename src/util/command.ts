
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import * as glob from 'glob-all';
import * as co from 'co';

import {window, commands} from 'vscode';
import * as nwjs from './nwjs/nwjs';
import * as os from './nwjs/os';
import * as run from './run';
import * as nfs from './nfs';
import * as vs from './vs';
import * as util from './util';

const NEED_INSTALL = 'NEED_INSTALL';
const NEED_PUBLISH_JSON = 'NEED_PUBLISH_JSON';
const NEED_PACKAGE_JSON = 'NEED_PACKAGE_JSON';

const DEFAULT_PACKAGE_JSON = {
    name: 'untitled',
    main: 'index.html'
};
const DEFAULT_PUBLISH_JSON = {
    "version":'any',
	"package":{},
	"html":["index.html"],
	"files":[],
	"exclude": []
};

var onProgress = false;
var selectedFile = '';
var selectedDir = '';

function replaceExt(filename:string, ext:string):string
{
    const extidx = filename.lastIndexOf('.');
    if (Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) < extidx)
        return filename.substr(0,extidx) + '.'+ext;
    else
        return filename + '.'+ext;
}

async function installNWjs(version?:string):Promise<void>
{
    if (!version)
    {
        version = await window.showQuickPick(
            nwjs.list().then(exists=>{
                const map = new Set;
                for(const v of exists) map.add(v);
                return nwjs.listAll(v=>!map.has(v));
            }),
            {placeHolder: "Select install version"});
        if (!version) return;
    }
    var downloaded = false;
    downloaded = (await nwjs.install(version)) || downloaded;
    downloaded = (await nwjs.install(version+'-sdk')) || downloaded;
    vs.clear();
    if(downloaded) vs.infoBox("Install complete");
    else vs.infoBox("NWjs already installed");
}

async function removeNWjs():Promise<void>
{
    const version = await window.showQuickPick(
        nwjs.list(v=>!v.endsWith('-sdk')),
        {placeHolder: "Select remove version"});
    if (!version) return;
    var res = false;
    res = nwjs.remove(version) || res;
    res = nwjs.remove(version+'-sdk') || res;
    if (res) vs.infoBox("Remove complete");
    else vs.infoBox("NWjs already removed");
}

async function compileNWjs(version?:string, filename?:string, outputFile?:string):Promise<void>
{
    if (!version)
    {
        var versions = await nwjs.list();
        versions = versions.filter(v=>!v.endsWith('-sdk'));
        if (versions.length !== 1)
            version = await window.showQuickPick(versions, {placeHolder: "Select compiler version"});
        else
            version = versions[0];
        if (!version) return;
    }
    if (!filename) filename = selectedFile;
    if (!outputFile) outputFile = replaceExt(filename, '.bin');

    const path = nwjs.getNwjc(version+'-sdk');
    if (path === null) throw new Error(NEED_INSTALL+'#'+version);
    await run(path, [filename, outputFile], str=>vs.log(str));
}

function replaceScriptTag(html:string, compileTargets:Object):string
{
    const regexp = /<script([ \t]+[^>]+)?>/g;
    const prop = /[ \t]+src=(["'])([^"']+)\1/;
    var out = '';
    var previous = 0;
    for(;;)
    {
        const res = regexp.exec(html);
        if (!res) break;
        const propres = prop.exec(res[1]);
        const end = html.indexOf("</script>", regexp.lastIndex);
        if (propres && propres[2])
        {
            const src = propres[2];
            out += html.substring(previous, res.index);
            const output = replaceExt(src,'bin');
            out += `<script>require('nw.gui').Window.get().evalNWBin(null, '${output}');</script>`;
            previous = end+9;
            compileTargets[src] = output;
        }
        regexp.lastIndex = end + 9;
    }
    out += html.substr(previous);
    return out;
}

async function makeNWjs(outdir:string, version:string, nwfile:string, packageJson:Object, exclude:Array<string>):Promise<void>
{
    const excludeMap = {};
    for(const ex of exclude)
        excludeMap[ex] = true;
    excludeMap['nw.exe'] = true;

    const srcdir = nwjs.getRootPath(version);
    for(const src of glob.sync([srcdir+'/**']))
    {
        const name = src.substr(srcdir.length+1);
        if (name in excludeMap) continue;
        const dest = path.join(outdir,name);
        if (fs.statSync(src).isDirectory())
        {
            try{fs.mkdirSync(dest);}catch(e){}
        }
        else
        {
            await nfs.copy(src, dest);
        }
    }

    if(os.platform === 'osx')
    {
        // Contents/Resources/nw.icns: icon of your app.
        // Contents/Info.plist: the apple package description file.
        await nfs.copy(nwfile, path.join(outdir,'nwjs.app/Contents/Resources/app.nw'));
    }
    else
    {
        const nwjsPath = nwjs.getPath(version);
        const exepath = path.join(outdir, packageJson.name+'.exe');
        const fos = fs.createWriteStream(exepath);
        await nfs.writeTo(nwjsPath, fos);
        await nfs.writeTo(nwfile, fos);
        fos.end();
    }
}

async function publishNWjs():Promise<void>
{
    if (!window.activeTextEditor) return;

    const config = nfs.readJson('nwjs.publish.json', DEFAULT_PUBLISH_JSON);
    if (!config) throw new Error(NEED_PUBLISH_JSON);
    var {html, files, exclude, nwjsVersion} = config;
    if (!nwjsVersion || nwjsVersion === 'any')
    {
        nwjsVersion = await nwjs.getLatestVersion();
        if (!nwjsVersion) throw new Error(NEED_INSTALL);
    }

    
    const nwjsPath = nwjs.getPath(nwjsVersion);
    if (nwjsPath === null) throw new Error(NEED_INSTALL+'#'+nwjsVersion);
    const curdir = process.cwd();
    process.chdir(path.dirname(window.activeTextEditor.document.fileName));


    const targets = {};
    const bindir = 'bin';
    const publishdir = 'publish';
    const packagejson = nfs.readJson('package.json', DEFAULT_PACKAGE_JSON);
    if (!packagejson) throw new Error(NEED_PACKAGE_JSON);

    util.override(packagejson, config.package);

    nfs.mkdir(bindir);
    nfs.mkdir(publishdir);
    const zippath = path.join(bindir, packagejson.name+'.zip');
    vs.show();
    vs.log('Conver html...');

    const archive = archiver('zip', {store: true});
    const zipfos = fs.createWriteStream(zippath);
    archive.pipe(zipfos);

    function appendText(filename, text)
    {
        archive.append(text, { name: filename });
    }
    function appendFile(filename, from)
    {
        if (from === undefined) from = filename;
        archive.file(from, { name: filename });
    }

    appendText('package.json', JSON.stringify(packagejson));

    for(const src of glob.sync(html))
    {
        vs.log(src);
        appendText(src, replaceScriptTag(fs.readFileSync(src,'utf-8'), targets));
    }
    vs.log('Compile js...');
    for(const src in targets)
    {
        vs.log(src);
        const binfilename = targets[src];
        const dest = path.join(bindir, binfilename);
        nfs.mkdir(path.dirname(dest));
        await compileNWjs(nwjsVersion, src, dest);
        appendFile(binfilename, dest);
    }
    vs.log('Add files...');
    for(const src of glob.sync(files))
    {
        if (fs.statSync(src).isDirectory()) continue;
        vs.log(src);
        appendFile(src);
    }

    vs.log('Flush zip...');
    archive.finalize();
    await nfs.eventToPromise(zipfos, 'close');

    vs.log('Generate exe...');
    await * makeNWjs(publishdir,nwjsVersion,zippath,packagejson, exclude);
    process.chdir(curdir);
    vs.log('Complete');
}

async function generatePublishJson():Promise<void>
{
    nfs.writeJson('nwjs.publish.json', DEFAULT_PUBLISH_JSON);
    vs.open(path.resolve('nwjs.publish.json'));
}

async function generatePackageJson():Promise<void>
{
    nfs.writeJson('package.json', DEFAULT_PACKAGE_JSON);
    vs.open(path.resolve('package.json'));
}

function play(prom:Promise<void>):Promise<void>
{
    return prom.catch((err)=>{
        const [msg, param] = err.message.split('#', 2);
        switch(msg)
        {
        case NEED_INSTALL:
            return vs.errorBox('Need install NWjs!', 'Install')
            .then((select)=>{
                if (!select) return;
                return play(installNWjs(param));
            });
        case NEED_PUBLISH_JSON:
            return vs.errorBox('Need nwjs.publish.json!', 'Generate')
            .then((select)=>{
                if (!select) return;
                return play(generatePublishJson());
            });
        case NEED_PACKAGE_JSON:
            return vs.errorBox('Need package.json!', 'Generate')
            .then((select)=>{
                if (!select) return;
                return play(generatePackageJson());
            });
        default:
            console.error(err.stack);
            vs.errorBox(err.message);
            break;
        }
    });
}

exports.activate = function (context) {
    console.log('[extension: vscode-nwjs] activate');
    function regist(command, genfunc)
    {
        const disposable = commands.registerCommand(command, ()=>{
            try
            {
                if (onProgress)
                {
                    vs.show();
                    return;
                }
                onProgress = true;
                vs.clear();
                vs.show();
                const stdout = process.stdout.write;
                const stderr = process.stderr.write;
                process.stdout.write = new vs.ChannelStream().bindWrite();
                process.stderr.write = new vs.ChannelStream().bindWrite();
                var olddir = '';
                if (window.activeTextEditor)
                {
                    selectedFile = window.activeTextEditor.document.fileName;
                    selectedDir = path.dirname(selectedFile);
                    olddir = process.cwd();
                    process.chdir(selectedDir);
                }
                else
                {
                    selectedFile = '';
                    selectedDir = '';
                }
                play(genfunc()).then(()=>{
                    if(olddir) process.chdir(olddir);
                    process.stdout.write = stdout;
                    process.stderr.write = stderr;
                    onProgress = false;
                });
            }
            catch(err)
            {
                console.error(err.stack);
                vs.errorBox(err.message);
            }
        });
        context.subscriptions.push(disposable);
    }

    regist('vscode-nwjs.install', installNWjs);
    regist('vscode-nwjs.remove', removeNWjs);
    regist('vscode-nwjs.publish', publishNWjs);
    regist('vscode-nwjs.compile', compileNWjs);
};
exports.deactivate = function() {
    console.log('[extension: vscode-nwjs] deactivate');
};
