import './sharePage.less';
import React, { useState, useEffect, useCallback } from 'react';
import Headtags   from '../../../../vitreum/headtags.js';
const Meta = Headtags.Meta;

import Nav from '@navbar/nav.jsx';
import Navbar from '@navbar/navbar.jsx';
import MetadataNav from '@navbar/metadata.navitem.jsx';
import PrintNavItem from '@navbar/print.navitem.jsx';
import RecentNavItems from '@navbar/recent.navitem.jsx';
const { both: RecentNavItem } = RecentNavItems;
import Account from '@navbar/account.navitem.jsx';
import BrewRenderer from '../../brewRenderer/brewRenderer.jsx';

import request from '../../utils/request-middleware.js';

import { DEFAULT_BREW_LOAD } from '../../../../server/brewDefaults.js';
import { printCurrentBrew, fetchThemeBundle } from '@shared/helpers.js';

const PING_INTERVAL = 30 * 1000;
const MAX_RECONNECT_DELAY = 60 * 1000;

// Opens a WebSocket to the brew's live update channel and calls onMessage for each update. Pings keep
// the connection alive; dropped connections reconnect with backoff. Returns a function that stops it.
const listenForUpdates = (shareId, onMessage)=>{
	let socket, pingTimer, reconnectTimer;
	let stopped = false;
	let reconnectDelay = 1000;

	const connect = ()=>{
		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		socket = new WebSocket(`${protocol}://${window.location.host}/api/stream/${shareId}`);
		socket.addEventListener('open', ()=>{
			reconnectDelay = 1000;
			pingTimer = setInterval(()=>socket.send('ping'), PING_INTERVAL);
		});
		socket.addEventListener('message', (event)=>{
			if(event.data === 'pong') return;
			try {
				onMessage(JSON.parse(event.data));
			} catch (error) {
				console.warn('Ignoring malformed brew update:', error);
			}
		});
		socket.addEventListener('close', ()=>{
			clearInterval(pingTimer);
			if(stopped) return;
			reconnectTimer = setTimeout(connect, reconnectDelay);
			reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
		});
	};

	connect();
	return ()=>{
		stopped = true;
		clearInterval(pingTimer);
		clearTimeout(reconnectTimer);
		socket?.close();
	};
};

const SharePage = (props)=>{
	const { disableMeta = false } = props;

	const [currentBrew, setCurrentBrew] = useState(props.brew || DEFAULT_BREW_LOAD);
	const [themeBundle,                setThemeBundle]                = useState({});
	const [currentBrewRendererPageNum, setCurrentBrewRendererPageNum] = useState(1);

	const handleBrewRendererPageChange = useCallback((pageNumber)=>{
		setCurrentBrewRendererPageNum(pageNumber);
	}, []);

	const handleControlKeys = (e)=>{
		if(!(e.ctrlKey || e.metaKey)) return;
		const P_KEY = 80;
		if(e.keyCode === P_KEY) {
			printCurrentBrew();
			e.stopPropagation();
			e.preventDefault();
		}
	};

	const fetchUpdatedBrew = async ()=>{
		const response = await request
			.get(`/api/fetch/${currentBrew.shareId}`)
			.catch((error)=>{
				console.log('error at fetching updated brew: ', error);
			});
		if(response.ok && !!response.body.brew) {
			setCurrentBrew(response.body.brew);
		}
	};

	useEffect(()=>{
		document.addEventListener('keydown', handleControlKeys);
		fetchThemeBundle(undefined, setThemeBundle, currentBrew.renderer, currentBrew.theme);

		// Listen for new versions if the brew has been updated in the last month
		const stopListening = Date.parse(props.brew?.updatedAt) > (new Date).setDate((new Date).getDate() - 30)
			? listenForUpdates(props.brew.shareId, (message)=>{
				if(message.event === 'brewUpdated' && message.version != currentBrew.version) fetchUpdatedBrew();
			})
			: ()=>{};

		return ()=>{
			document.removeEventListener('keydown', handleControlKeys);
			stopListening();
		};
	}, []);

	const processShareId = ()=>currentBrew.shareId;

	const renderEditLink = ()=>{
		if(!currentBrew.editId) return null;

		const editLink = currentBrew.editId;

		return (
			<Nav.item color='orange' icon='fas fa-pencil-alt' href={`/edit/${editLink}`}>
				edit
			</Nav.item>
		);
	};

	const titleEl = (
		<Nav.item className='brewTitle' style={disableMeta ? { cursor: 'default' } : {}}>
			{currentBrew.title}
		</Nav.item>
	);

	return (
		<div className='sharePage sitePage'>
			<Meta name='robots' content='noindex, nofollow' />
			<Navbar>
				<Nav.section className='titleSection'>
					{disableMeta ? titleEl : <MetadataNav brew={currentBrew}>{titleEl}</MetadataNav>}
				</Nav.section>

				<Nav.section>
					{currentBrew.shareId && (
						<>
							<PrintNavItem />
							<Nav.dropdown>
								<Nav.item color='red' icon='fas fa-code'>
									source
								</Nav.item>
								<Nav.item color='blue' icon='fas fa-eye' href={`/source/${processShareId()}`}>
									view
								</Nav.item>
								{renderEditLink()}
								<Nav.item color='blue' icon='fas fa-download' href={`/download/${processShareId()}`}>
									download
								</Nav.item>
								<Nav.item color='blue' icon='fas fa-clone' href={`/new/${processShareId()}`}>
									clone to new
								</Nav.item>
								<Nav.item
									color='blue'
									icon='fas fa-link'
									onClick={()=>{navigator.clipboard.writeText(`${global.config.baseUrl}/share/${processShareId()}`);}}>
									copy url
								</Nav.item>
								{currentBrewRendererPageNum > 1 &&
									<Nav.item
										color='blue'
										icon='fas fa-hashtag'
										onClick={()=>{navigator.clipboard.writeText(`${global.config.baseUrl}/share/${processShareId()}#p${currentBrewRendererPageNum}`);}}>
										copy url (page {currentBrewRendererPageNum})
									</Nav.item>}
							</Nav.dropdown>
						</>
					)}
					<RecentNavItem brew={currentBrew} storageKey='view' />
					<Account />
				</Nav.section>
			</Navbar>

			<div className='content'>
				<BrewRenderer
					text={currentBrew.text}
					style={currentBrew.style}
					lang={currentBrew.lang}
					renderer={currentBrew.renderer}
					theme={currentBrew.theme}
					themeBundle={themeBundle}
					onPageChange={handleBrewRendererPageChange}
					allowPrint={true}
				/>
			</div>
		</div>
	);
};

export default SharePage;
