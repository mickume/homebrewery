import React from 'react';
import moment from 'moment';
import UIPage from '../basePages/uiPage/uiPage.jsx';
import NaturalCritIcon from '@components/svg/naturalcrit-d20.svg.jsx';

const AccountPage = (props)=>{
	const { accountDetails, brew } = props;

	// render the entirety of the account page content
	const renderAccountPage = ()=>{
		return (
			<>
				<div className='dataGroup'>
					<h1>Account Information <i className='fas fa-user'></i></h1>
					<p><strong>Username: </strong>{accountDetails.username || 'No user currently logged in'}</p>
					<p><strong>Last Login: </strong>{moment(accountDetails.issued).format('dddd, MMMM Do YYYY, h:mm:ss a ZZ') || '-'}</p>
				</div>
				<div className='dataGroup'>
					<h3>Homebrewery Information <NaturalCritIcon /></h3>
					<p><strong>Brews on Homebrewery: </strong>{accountDetails.brewCount}</p>
				</div>
			</>
		);
	};

	// return the account page inside the base layout wrapper (with navbar etc).
	return (
		<UIPage brew={brew}>
			{renderAccountPage()}
		</UIPage>);
};

export default AccountPage;
