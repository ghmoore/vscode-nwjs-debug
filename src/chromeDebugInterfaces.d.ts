/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Core from 'vscode-chrome-debug-core';

export interface ICommonRequestArgs extends Core.ICommonRequestArgs {
    disableNetworkCache?: boolean;
    urlFilter?: string;
}

export interface ILaunchRequestArgs extends Core.ILaunchRequestArgs, ICommonRequestArgs {
    runtimeArgs?: string[];
    runtimeExecutable?: string;
    file?: string;
    url?: string;
    stopOnEntry?: boolean;
    address?: string;
    port?: number;
    userDataDir?: string;
    nwjsVersion?:string;
}

export interface IAttachRequestArgs extends Core.IAttachRequestArgs, ICommonRequestArgs {
}