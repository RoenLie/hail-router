import './polyfills.js';

import { animateTo, stopAnimations } from './animate.js';
import type { ElementAnimation } from './animate-registry.js';
import { clone } from './clone.js';
import { createPromiseResolver } from './createPromise.js';
import { RouteHistory } from './route-history-base.js';

/* ------------------------------------------------- */

interface Route {
	path: string;
	name?: string;
	component?: string;
	action?: () => Promise<void | undefined | typeof HTMLElement>;
	animation?: { show: ElementAnimation; hide: ElementAnimation };
	redirect?: string;
	children?: Route[];
}

interface InternalRoute {
	path: Route['path'][];
	name: Route['name'];
	component: Route['component'][];
	action: Route['action'][];
	animation: Route['animation'][];
	redirect: Route['redirect'][];
}

type RouteElement = Element & { __routeAnimation?: Route['animation']; };

/* ------------------------------------------------- */

/* This check is used to prevent infinite redirects. */
const MAX_REDIRECTIONS = 200;

/* ------------------------------------------------- */

export class Router {

	protected outlet: Element;
	protected routes: InternalRoute[];
	protected history: RouteHistory;
	protected baseUrl = location.origin;
	protected updateComplete = Promise.resolve(true);
	protected redirectionCount = 0;


	constructor() { }

	public setHistorian(historian: RouteHistory) {
		this.history = historian;
	}

	public setOutlet(element: Element) {
		this.outlet = element;
		if (element.shadowRoot) {
			const slot = document.createElement('slot');
			element.shadowRoot?.appendChild(slot);
		}

		this.initialize();
	}

	public setRoutes(routes: Route[]) {
		this.routes = this.parseRoutes(routes);

		this.initialize();
	}

	protected initialize() {
		if (!this.routes || !this.outlet || !this.history)
			return;

		this.history.clearHistory();
		this.navigate(this.location());
	}

	public location() {
		return this.history.getRoute();
	}

	public async navigate(route: string) {
		await this.updateComplete;

		const [ promise, resolver ] = createPromiseResolver<boolean>();
		this.updateComplete = promise;

		/* find the best matching route */
		const futureRoute = this.getMatchingRoute(route);

		/* if a match was not found, do nothing */
		if (!futureRoute)
			return resolver(true);

		/* Generate the component chain for the matching route */
		const componentChain: RouteElement[] = [];
		for (let i = 0; i < futureRoute.component.length; i++) {
			const component = futureRoute.component[i];

			let actionResult = await futureRoute.action[i]?.();

			let el: RouteElement | undefined;
			if (actionResult)
				el = new actionResult();

			el = !el ? document.createElement(component ?? 'div') : el;
			el.__routeAnimation = futureRoute.animation[i];

			componentChain.push(el);
		}

		/* Redirect to the last redirect if there is one. */
		const whereToRedirect = futureRoute.redirect.at(-1);
		if (whereToRedirect !== undefined) {
			if (this.redirectionCount > MAX_REDIRECTIONS)
				throw ('Circular redirections detected.');

			this.redirectionCount++;
			this.navigate(whereToRedirect);

			return resolver(true);
		}

		const replaceRouteNodes = async (parent: Element, depth = 0) => {
			let nodeToInsert = componentChain[depth];
			if (!nodeToInsert)
				return await this.reversedRouteNodeRemoval(parent as RouteElement);

			let childElements = Array.from(parent.children) as RouteElement[];
			let invalidNodes = childElements.filter(el => el.tagName !== nodeToInsert?.tagName);
			for (const el of invalidNodes)
				await this.reversedRouteNodeRemoval(el, true);

			depth ++;

			if (parent.firstElementChild) {
				await replaceRouteNodes(parent.firstElementChild, depth);
			}
			else {
				parent.insertAdjacentElement('afterbegin', nodeToInsert);

				let anim = nodeToInsert?.__routeAnimation?.show;
				if (anim) {
					await stopAnimations(nodeToInsert);
					await animateTo(nodeToInsert, anim.keyframes, anim.options);
				}

				await replaceRouteNodes(nodeToInsert, depth);
			}
		};

		await this.beforeNavigate();

		this.history.setRoute(route);
		replaceRouteNodes(this.outlet);

		await this.afterNavigate();

		resolver(true);
		this.redirectionCount = 0;

		return route;
	}

	protected async beforeNavigate() {
		//console.log('before set route');
	}

	protected async afterNavigate() {
		//console.log('after set route');
	}

	protected parseRoutes(
		routes: Route[] | undefined,
		parsedRoutes: InternalRoute[] = [],
		route: InternalRoute = {
			path:      [],
			name:      undefined,
			component: [],
			action:    [],
			animation: [],
			redirect:  [],
		},
	) {
		if (!routes?.length)
			return parsedRoutes;

		routes.forEach(r => {
			const clonedRoute = clone(route);

			clonedRoute.name = r.name;
			clonedRoute.path.push(r.path);
			clonedRoute.redirect.push(r.redirect);
			clonedRoute.component.push(r.component);
			clonedRoute.action.push(r.action);
			clonedRoute.animation.push(r.animation);

			parsedRoutes.push(clonedRoute);

			this.parseRoutes(r.children, parsedRoutes, clonedRoute);
		});

		return parsedRoutes;
	}

	protected getMatchingRoute(route: string) {
		console.log({ route });


		const match = this.routes.find(r => {
			const pattern = new URLPattern({
				pathname: r.path.join('/'),
				baseURL:  this.baseUrl,
			});

			return pattern.test(route, this.baseUrl);
		});

		console.log({ match });


		return match;
	}

	protected async removeRouteElement(el: RouteElement) {
		let anim = el.__routeAnimation?.hide;
		if (anim) {
			await stopAnimations(el);
			await animateTo(el, anim.keyframes, anim.options);
		}

		el.remove();
	}

	protected async reversedRouteNodeRemoval(node: RouteElement, removeParent?: boolean) {
		while (node.firstChild) {
			let child = node.firstChild as RouteElement;
			await this.reversedRouteNodeRemoval(child);
			await this.removeRouteElement(child);
		}

		if (removeParent)
			await this.removeRouteElement(node);
	}

}
