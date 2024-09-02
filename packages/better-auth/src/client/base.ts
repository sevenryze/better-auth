import { createFetch } from "@better-fetch/fetch";
import type { Auth } from "../auth";
import { getBaseURL } from "../utils/base-url";
import { addCurrentURL, csrfPlugin, redirectPlugin } from "./fetch-plugins";
import type { InferRoutes } from "./path-to-object";
import { createDynamicPathProxy, type AuthProxySignal } from "./proxy";
import { getSessionAtom } from "./session-atom";
import type { AuthPlugin, ClientOptions } from "./type";
import type { UnionToIntersection } from "../types/helper";
import type { PreinitializedWritableAtom } from "nanostores";
import type { BetterAuthPlugin } from "../types/plugins";

/**
 * used for plugins only
 */

export const createAuthFetch = (options?: ClientOptions) => {
	const $baseFetch = createFetch();
	return createFetch({
		method: "GET",
		...options,
		baseURL: getBaseURL(options?.baseURL).withPath,
		plugins: [
			...(options?.plugins || []),
			...(options?.authPlugins
				?.flatMap((plugin) => plugin($baseFetch).fetchPlugins)
				.filter((plugin) => plugin !== undefined) || []),
			...(options?.csrfPlugin !== false ? [csrfPlugin] : []),
			redirectPlugin,
			addCurrentURL,
		],
	});
};

export const createAuthClient = <
	O extends ClientOptions = ClientOptions,
	AT extends Record<string, any> = {},
>(
	options?: O,
	additionalActions = {} as AT,
) => {
	type API = O["authPlugins"] extends Array<any>
		? (O["authPlugins"] extends Array<infer Pl>
				? UnionToIntersection<
						//@ts-expect-error
						ReturnType<Pl> extends {
							plugin: infer Plug;
						}
							? Plug extends BetterAuthPlugin
								? Plug["endpoints"]
								: {}
							: {}
					>
				: {}) &
				Auth["api"]
		: Auth["api"];

	const $fetch = createAuthFetch(options);

	type Plugins = O["authPlugins"] extends Array<AuthPlugin>
		? Array<ReturnType<O["authPlugins"][number]>["plugin"]>
		: undefined;
	//@ts-expect-error
	const { $session, $sessionSignal } = getSessionAtom<{
		handler: any;
		api: any;
		options: {
			database: any;
			plugins: Plugins;
		};
	}>($fetch);

	let pluginsActions = {} as Record<string, any>;
	type PluginActions = UnionToIntersection<
		O["authPlugins"] extends Array<infer Pl>
			? //@ts-expect-error
				ReturnType<Pl> extends {
					actions?: infer R;
				}
				? R
				: {}
			: {}
	>;

	const pluginProxySignals: AuthProxySignal[] = [];
	let pluginSignals: Record<string, PreinitializedWritableAtom<boolean>> = {};
	let pluginPathMethods: Record<string, "POST" | "GET"> = {};

	for (const plugin of options?.authPlugins || []) {
		const pl = plugin($fetch);
		if (pl.authProxySignal) {
			pluginProxySignals.push(...pl.authProxySignal);
		}
		if (pl.actions) {
			pluginsActions = {
				...pluginsActions,
				...pl.actions,
			};
		}
		if (pl.signals) {
			pluginSignals = {
				...pluginSignals,
				...pl.signals,
			};
		}
		if (pl.pathMethods) {
			pluginPathMethods = {
				...pluginPathMethods,
				...pl.pathMethods,
			};
		}
	}

	const actions = {
		$atoms: {
			$session,
		},
		$fetch,
		...(pluginsActions as object),
		...additionalActions,
	};

	type Actions = typeof actions & PluginActions;

	const proxy = createDynamicPathProxy(
		actions,
		$fetch,
		{
			...pluginPathMethods,
			"/sign-out": "POST",
		},
		[
			{
				matcher: (path) => path === "/organization/create",
				atom: "$listOrg",
			},
			{
				matcher: (path) => path.startsWith("/organization"),
				atom: "$activeOrgSignal",
			},
			{
				matcher: (path) =>
					path === "/sign-out" ||
					path.startsWith("/sign-up") ||
					path.startsWith("/sign-in"),
				atom: "$sessionSignal",
			},
			...pluginProxySignals,
		],
		{
			$sessionSignal,
			...pluginSignals,
		},
	) as unknown as InferRoutes<API> & Actions;
	return proxy;
};