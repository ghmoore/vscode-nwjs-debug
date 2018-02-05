
import * as fs from 'fs';
import * as path from 'path';
import { trimLastNewline } from 'vscode-chrome-debug-core/lib/src/utils';

export function readJsonSync(file:string, def?:Object, forceCreate?:boolean):any
{
    var obj:any = null;
    try
    {
        obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch(e)
    {
        if(!forceCreate) return null;
    }
    if (def)
    {
        var modified = false;
        if (!(obj instanceof Object))
        {
            obj = {};
            modified = true;
        }
        for(const p in def)
        {
            if (p in obj) continue;
            obj[p] = def[p];
            modified = true;
        }
        if (forceCreate && modified) writeJsonSync(file, obj);
    }
    return obj;
}

export async function readJson(file:string, def?:Object, forceCreate?:boolean):Promise<any>
{
    var obj:any = null;
    try
    {
        obj = JSON.parse(await readFile(file));
    }
    catch(e)
    {
        if(!forceCreate) return null;
    }
    if (def)
    {
        var modified = false;
        if (!(obj instanceof Object))
        {
            obj = {};
            modified = true;
        }
        for(const p in def)
        {
            if (p in obj) continue;
            obj[p] = def[p];
            modified = true;
        }
        if (forceCreate && modified) await writeJson(file, obj);
    }
    return obj;
}

export function writeJson(file:string, obj:any):Promise<void>
{
    return writeFile(file, JSON.stringify(obj, null, 2));
}

export function writeJsonSync(file:string, obj:any):void
{
    return fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function mkdirOne(dirPath:string):Promise<void>
{
    return new Promise((resolve, reject)=>{
        fs.mkdir(dirPath, err=>err ? reject(err) : resolve());
    });
}

function copyOnly(from:string, to:string):Promise<void>
{
    return new Promise<void>((resolve, reject)=>{
        const fos = fs.createWriteStream(to);
        fs.createReadStream(from).pipe(fos).on('error', reject);
        fos.on('error', reject).on('close', resolve);
    });
}

export function stat(path:string):Promise<fs.Stats>
{
    return new Promise((resolve, reject)=>{
        fs.stat(path, (err, stats)=>{
            if (err) reject(err);
            else resolve(stats);
        });
    });
}

export async function mkdir(dirPath:string):Promise<void>
{
    try
    {
        await mkdirOne(dirPath);
    }
    catch(error)
    {
        switch(error.code)
        {
        case 'ENOENT':
            await mkdir(path.dirname(dirPath));
            await mkdirOne(dirPath);
            return;
        case 'EEXIST':
            return;
        }
        throw error;
    }
}

export function mkdirSync(dirPath:string):void
{
    try
    {
        fs.mkdirSync(dirPath);
    }
    catch(error)
    {
        switch(error.code)
        {
        case 'ENOENT':
            mkdirSync(path.dirname(dirPath));
            fs.mkdirSync(dirPath);
            return;
        case 'EEXIST':
            return;
        }
        throw error;
    }
}

export function writeTo(filename:string, fos:fs.WriteStream):Promise<void>
{
    return new Promise<void>((resolve, reject)=>{
        const read = fs.createReadStream(filename);
        read.pipe(fos, {end: false});
        read.on('error', reject);
        read.on('end', resolve);
    });
}

export async function copy(from:string, to:string):Promise<void>
{
    try
    {
        await copyOnly(from, to);
    }
    catch (err)
    {
        if (err.code === 'ENOENT')
        {
            await mkdir(path.dirname(to));
            await copyOnly(from, to);
        }
    }
}

export function writeFile(path:string, data:string):Promise<void>
{
    return new Promise((resolve, reject)=>{
        fs.writeFile(path, data, 'utf-8', err=>{
            if (err) reject(err);
            else resolve();
        });
    });
}

export function readFile(path:string):Promise<string>
{
    return new Promise((resolve, reject)=>{
        fs.readFile(path, 'utf-8', (err, data)=>{
            if (err) reject(err);
            else resolve(data);
        });
    });
}

export function exists(path:string):Promise<boolean>
{
    return new Promise<boolean>(resolve=>fs.exists(path, resolve));
}
